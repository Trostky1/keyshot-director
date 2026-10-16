use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};

const MAX_INPUT_BYTES: usize = 1_048_576;
static OUTPUT: OnceLock<Mutex<Vec<u8>>> = OnceLock::new();

#[derive(Debug)]
#[derive(Clone)]
enum Json {
    String(String),
    Array(Vec<Json>),
    Object(BTreeMap<String, Json>),
    Other,
}

struct Parser<'a> { bytes: &'a [u8], at: usize }

impl<'a> Parser<'a> {
    fn ws(&mut self) { while self.bytes.get(self.at).is_some_and(u8::is_ascii_whitespace) { self.at += 1; } }
    fn byte(&self) -> Option<u8> { self.bytes.get(self.at).copied() }
    fn string(&mut self) -> Result<String, String> {
        if self.byte() != Some(b'"') { return Err("Expected a JSON string".into()); }
        self.at += 1;
        let mut out = String::new();
        let mut plain = self.at;
        loop {
            let b = self.byte().ok_or("Unterminated JSON string")?;
            match b {
                b'"' => {
                    out.push_str(std::str::from_utf8(&self.bytes[plain..self.at]).map_err(|_| "Invalid UTF-8 in JSON string")?);
                    self.at += 1;
                    return Ok(out);
                }
                b'\\' => {
                    out.push_str(std::str::from_utf8(&self.bytes[plain..self.at]).map_err(|_| "Invalid UTF-8 in JSON string")?);
                    self.at += 1;
                    let escaped = self.byte().ok_or("Incomplete JSON escape")?;
                    self.at += 1;
                    match escaped {
                        b'"' => out.push('"'), b'\\' => out.push('\\'), b'/' => out.push('/'),
                        b'b' => out.push('\u{0008}'), b'f' => out.push('\u{000c}'), b'n' => out.push('\n'),
                        b'r' => out.push('\r'), b't' => out.push('\t'),
                        b'u' => {
                            let first = self.hex4()?;
                            let scalar = if (0xd800..=0xdbff).contains(&first) {
                                if self.bytes.get(self.at..self.at + 2) != Some(b"\\u") { return Err("Invalid Unicode surrogate pair".into()); }
                                self.at += 2;
                                let second = self.hex4()?;
                                if !(0xdc00..=0xdfff).contains(&second) { return Err("Invalid Unicode surrogate pair".into()); }
                                0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00)
                            } else { first };
                            out.push(char::from_u32(scalar).ok_or("Invalid Unicode escape")?);
                        }
                        _ => return Err("Invalid JSON escape".into()),
                    }
                    plain = self.at;
                }
                0..=31 => return Err("Unescaped control character in JSON string".into()),
                _ => self.at += 1,
            }
        }
    }
    fn hex4(&mut self) -> Result<u32, String> {
        let mut value = 0;
        for _ in 0..4 {
            let b = self.byte().ok_or("Incomplete Unicode escape")?;
            self.at += 1;
            value = value * 16 + match b { b'0'..=b'9' => (b - b'0') as u32, b'a'..=b'f' => (b - b'a' + 10) as u32, b'A'..=b'F' => (b - b'A' + 10) as u32, _ => return Err("Invalid Unicode escape".into()) };
        }
        Ok(value)
    }
    fn value(&mut self, depth: u8) -> Result<Json, String> {
        if depth > 8 { return Err("Recipe JSON is nested too deeply".into()); }
        self.ws();
        match self.byte().ok_or("Missing JSON value")? {
            b'"' => Ok(Json::String(self.string()?)),
            b'[' => {
                self.at += 1; self.ws(); let mut values = Vec::new();
                if self.byte() == Some(b']') { self.at += 1; return Ok(Json::Array(values)); }
                loop {
                    values.push(self.value(depth + 1)?); self.ws();
                    match self.byte() { Some(b',') => { self.at += 1; }, Some(b']') => { self.at += 1; break; }, _ => return Err("Expected comma or closing bracket".into()) }
                }
                Ok(Json::Array(values))
            }
            b'{' => {
                self.at += 1; self.ws(); let mut fields = BTreeMap::new();
                if self.byte() == Some(b'}') { self.at += 1; return Ok(Json::Object(fields)); }
                loop {
                    self.ws(); let key = self.string()?; self.ws();
                    if self.byte() != Some(b':') { return Err("Expected colon in JSON object".into()); }
                    self.at += 1;
                    if fields.insert(key, self.value(depth + 1)?).is_some() { return Err("Duplicate key in recipe JSON".into()); }
                    self.ws();
                    match self.byte() { Some(b',') => { self.at += 1; }, Some(b'}') => { self.at += 1; break; }, _ => return Err("Expected comma or closing brace".into()) }
                }
                Ok(Json::Object(fields))
            }
            _ => {
                let start = self.at;
                while self.byte().is_some_and(|b| !b.is_ascii_whitespace() && !matches!(b, b',' | b']' | b'}')) { self.at += 1; }
                if self.at == start { return Err("Invalid JSON value".into()); }
                Ok(Json::Other)
            }
        }
    }
}

#[derive(Debug)]
struct TextureFile { name: String, role: String }
#[derive(Debug)]
struct MapAssignment { role: String, path: String, color_space: &'static str, target: &'static str }
#[derive(Debug)]
struct NodeSpec { id: String, kind: &'static str }
#[derive(Debug)]
struct EdgeSpec { from: String, to: String, input: &'static str }
#[derive(Debug)]
struct SkippedFile { name: String, role: String, reason: String }
#[derive(Debug)]
struct Plan { name: String, model: &'static str, maps: Vec<MapAssignment>, nodes: Vec<NodeSpec>, edges: Vec<EdgeSpec>, warnings: Vec<String>, skipped: Vec<SkippedFile> }

fn object(value: Json) -> Result<BTreeMap<String, Json>, String> { if let Json::Object(v) = value { Ok(v) } else { Err("Recipe must be a JSON object".into()) } }
fn text_field(fields: &BTreeMap<String, Json>, key: &str) -> Result<String, String> {
    match fields.get(key) { Some(Json::String(v)) => Ok(v.clone()), _ => Err(format!("Recipe field '{key}' must be a string")) }
}
fn request(bytes: &[u8]) -> Result<(String, Vec<TextureFile>), String> {
    let mut parser = Parser { bytes, at: 0 };
    let fields = object(parser.value(0)?)?;
    parser.ws();
    if parser.at != bytes.len() { return Err("Unexpected data after recipe JSON".into()); }
    let name = text_field(&fields, "name")?;
    let values = match fields.get("files") { Some(Json::Array(v)) => v, _ => return Err("Recipe field 'files' must be an array".into()) };
    let mut files = Vec::new();
    for value in values {
        let fields = match value { Json::Object(v) => v, _ => return Err("Each texture file must be an object".into()) };
        files.push(TextureFile { name: text_field(&fields, "name")?, role: text_field(&fields, "role")? });
    }
    Ok((name, files))
}

fn safe_relative_path(value: &str) -> bool {
    let normalized = value.replace('\\', "/");
    !normalized.is_empty() && !normalized.starts_with('/')
        && !normalized.contains(':')
        && !normalized.as_bytes().get(1).is_some_and(|b| *b == b':')
        && normalized.split('/').all(|part| !part.is_empty() && part != "." && part != "..")
        && !normalized.chars().any(char::is_control)
}

fn compile(name: String, mut files: Vec<TextureFile>) -> Result<Plan, String> {
    let name = name.trim().to_owned();
    if name.is_empty() || name.len() > 80 || name.chars().any(char::is_control) { return Err("Material name must contain 1 to 80 printable characters.".into()); }
    if files.is_empty() || files.len() > 24 { return Err("A texture set must contain between 1 and 24 files.".into()); }
    files.sort_by_key(|file| match file.role.as_str() {
        "base-color" => 0, "ambient-occlusion" => 1, "roughness" => 2,
        "normal" => 3, "bump" => 4, _ => 5,
    });
    let mut chosen: Vec<TextureFile> = Vec::new();
    let mut warnings = Vec::new();
    let mut skipped = Vec::new();
    for file in files {
        if !safe_relative_path(&file.name) { return Err(format!("Unsafe texture path: {}", file.name)); }
        if !matches!(file.role.as_str(), "base-color" | "ambient-occlusion" | "roughness" | "normal" | "bump") {
            skipped.push(SkippedFile { name: file.name, role: file.role, reason: "This channel is outside the Simple Plastic material path.".into() });
            continue;
        }
        let conflict = chosen.iter().any(|current| current.role == file.role
            || (matches!(file.role.as_str(), "normal" | "bump") && matches!(current.role.as_str(), "normal" | "bump")));
        if conflict {
            warnings.push(format!("Ignored additional {} map '{}'; one file can drive this input.", file.role, file.name));
            skipped.push(SkippedFile { name: file.name, role: file.role, reason: "Another map already supplies this shader input.".into() });
        } else { chosen.push(file); }
    }
    if chosen.is_empty() { return Err("No supported Base Color, Roughness, Normal or Bump maps were found.".into()); }
    // AO without Base Color is ignored by the bridge, so report it explicitly.
    if chosen.iter().any(|f| f.role == "ambient-occlusion") && !chosen.iter().any(|f| f.role == "base-color") {
        let index = chosen.iter().position(|f| f.role == "ambient-occlusion").unwrap();
        let ao = chosen.remove(index);
        skipped.push(SkippedFile { name: ao.name, role: ao.role, reason: "AO needs Base Color to blend into the Plastic diffuse color.".into() });
    }
    if chosen.is_empty() { return Err("No supported Base Color, Roughness, Normal or Bump maps were found.".into()); }
    let use_ao = chosen.iter().any(|f| f.role == "ambient-occlusion");
    let mut maps = Vec::new();
    let mut nodes = vec![NodeSpec { id: "root".into(), kind: "Material" }, NodeSpec { id: "surface".into(), kind: "Plastic" }];
    let mut edges = vec![EdgeSpec { from: "surface".into(), to: "root".into(), input: "surface" }];
    if use_ao {
        nodes.push(NodeSpec { id: "composite:ao".into(), kind: "Color Composite Multiply" });
        edges.push(EdgeSpec { from: "composite:ao".into(), to: "surface".into(), input: "diffuse" });
    }
    for file in chosen {
        let (color_space, target) = match file.role.as_str() {
            "base-color" => ("srgb", if use_ao { "background" } else { "diffuse" }),
            "ambient-occlusion" => ("linear", "source"), "roughness" => ("linear", "roughness"),
            "normal" | "bump" => ("linear", "bumpmap"), _ => unreachable!(),
        };
        let id = format!("map:{}", file.role);
        nodes.push(NodeSpec { id: id.clone(), kind: "Texture Map" });
        if file.role == "roughness" {
            nodes.push(NodeSpec { id: "convert:roughness".into(), kind: "Color To Number" });
            edges.push(EdgeSpec { from: id.clone(), to: "convert:roughness".into(), input: "input" });
            edges.push(EdgeSpec { from: "convert:roughness".into(), to: "surface".into(), input: "roughness" });
        } else if file.role == "base-color" {
            edges.push(EdgeSpec { from: id, to: if use_ao { "composite:ao" } else { "surface" }.into(), input: if use_ao { "background" } else { "diffuse" } });
        } else if file.role == "ambient-occlusion" {
            edges.push(EdgeSpec { from: id, to: "composite:ao".into(), input: "source" });
        } else {
            edges.push(EdgeSpec { from: id, to: "surface".into(), input: target });
        }
        maps.push(MapAssignment { role: file.role, path: file.name, color_space, target });
    }
    Ok(Plan { name, model: "Plastic", maps, nodes, edges, warnings, skipped })
}

fn quote(value: &str) -> String {
    let mut out = String::from("\"");
    for ch in value.chars() { match ch { '"' => out.push_str("\\\""), '\\' => out.push_str("\\\\"), '\n' => out.push_str("\\n"), '\r' => out.push_str("\\r"), '\t' => out.push_str("\\t"), c if c <= '\u{001f}' => out.push_str(&format!("\\u{:04x}", c as u32)), c => out.push(c) } }
    out.push('"'); out
}
fn encode_plan(plan: &Plan) -> String {
    let maps = plan.maps.iter().map(|m| format!("{{\"role\":{},\"path\":{},\"color_space\":{},\"target\":{}}}", quote(&m.role), quote(&m.path), quote(m.color_space), quote(m.target))).collect::<Vec<_>>().join(",");
    let nodes = plan.nodes.iter().map(|n| format!("{{\"id\":{},\"kind\":{}}}", quote(&n.id), quote(n.kind))).collect::<Vec<_>>().join(",");
    let edges = plan.edges.iter().map(|e| format!("{{\"from\":{},\"to\":{},\"input\":{}}}", quote(&e.from), quote(&e.to), quote(e.input))).collect::<Vec<_>>().join(",");
    let warnings = plan.warnings.iter().map(|v| quote(v)).collect::<Vec<_>>().join(",");
    let skipped = plan.skipped.iter().map(|s| format!("{{\"name\":{},\"role\":{},\"reason\":{}}}", quote(&s.name), quote(&s.role), quote(&s.reason))).collect::<Vec<_>>().join(",");
    format!("{{\"ok\":true,\"plan\":{{\"schema_version\":1,\"material\":{{\"name\":{},\"model\":{}}},\"maps\":[{}],\"graph\":{{\"root\":\"root\",\"nodes\":[{}],\"edges\":[{}]}},\"warnings\":[{}],\"skipped\":[{}]}},\"error\":null}}", quote(&plan.name), quote(plan.model), maps, nodes, edges, warnings, skipped)
}
fn encode_error(error: &str) -> String { format!("{{\"ok\":false,\"plan\":null,\"error\":{}}}", quote(error)) }

#[unsafe(no_mangle)]
pub extern "C" fn material_alloc(size: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; size].into_boxed_slice()) as *mut u8
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn material_compile(ptr: *const u8, len: usize) -> i32 {
    if ptr.is_null() || len == 0 || len > MAX_INPUT_BYTES { return -1; }
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let response = match request(bytes).and_then(|(name, files)| compile(name, files)) { Ok(plan) => encode_plan(&plan), Err(error) => encode_error(&error) };
    let mut slot = OUTPUT.get_or_init(|| Mutex::new(Vec::new())).lock().unwrap();
    *slot = response.into_bytes(); 0
}
#[unsafe(no_mangle)]
pub extern "C" fn material_output_ptr() -> *const u8 { OUTPUT.get_or_init(|| Mutex::new(Vec::new())).lock().unwrap().as_ptr() }
#[unsafe(no_mangle)]
pub extern "C" fn material_output_len() -> usize { OUTPUT.get_or_init(|| Mutex::new(Vec::new())).lock().unwrap().len() }
#[unsafe(no_mangle)]
pub extern "C" fn material_dealloc(ptr: *mut u8, size: usize) { if !ptr.is_null() { unsafe { drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, size))); } } }
