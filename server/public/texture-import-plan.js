// Plan imports from folders selected by the user. No network requests or file writes.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TextureImportPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const extensions = new Set(['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'exr', 'hdr', 'mtlx']);
  const generic = /^(?:textures?|maps?|pbr|keyshot|poliigon|images?|jpe?g|png|tiff?|exr)$/i;
  const resolution = /(?:^|[_ .-])(1K|2K|4K|8K|16K)(?=$|[_ .-])/i;
  const preferred = ['4K', '2K', '8K', '1K', '16K'];
  const fileLimit = 80 * 1024 * 1024;
  const setLimit = 512 * 1024 * 1024;

  function resolutionOf(parts, name) {
    for (const part of [...parts, name]) {
      const match = part.match(resolution);
      if (match) return match[1].toUpperCase();
    }
    return '';
  }
  function groupName(parts, rootName) {
    const candidate = parts.find(part => !generic.test(part) && !resolution.test(part));
    return candidate || rootName || 'Imported texture set';
  }
  function plan(files, { targetResolution = '4K' } = {}) {
    const input = [...files];
    const paths = input.map(file => String(file.webkitRelativePath || file.relativePath || file.name).replace(/\\/g, '/').split('/').filter(Boolean));
    const sharedRoot = paths.length > 0 && paths.every(parts => parts.length > 1 && parts[0] === paths[0][0]);
    const rootName = sharedRoot ? paths[0][0] : '';
    const groups = new Map();
    let ignored = 0;
    for (let index = 0; index < input.length; index++) {
      const file = input[index], name = file.name;
      const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
      if (!extensions.has(ext) || /preview|thumbnail|swatch/i.test(name)) { ignored++; continue; }
      const parts = paths[index].slice(sharedRoot ? 1 : 0, -1);
      const label = groupName(parts, rootName);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push({ file, resolution: resolutionOf(parts, name) });
    }
    const output = [];
    for (const [name, entries] of groups) {
      const available = new Set(entries.map(entry => entry.resolution).filter(Boolean));
      const order = [targetResolution, ...preferred].filter((value, index, array) => array.indexOf(value) === index);
      const chosen = order.find(value => available.has(value)) || '';
      const selected = entries.filter(entry => !entry.resolution || entry.resolution === chosen);
      const unique = new Map();
      for (const entry of selected) {
        const key = entry.file.name.toLowerCase();
        if (!unique.has(key)) unique.set(key, entry.file);
      }
      const chosenFiles = [...unique.values()];
      const bytes = chosenFiles.reduce((total, file) => total + file.size, 0);
      const issue = chosenFiles.length > 24 ? `More than 24 maps remain in ${name}. Choose a single asset or resolution folder.`
        : chosenFiles.some(file => !file.size || file.size > fileLimit) ? `${name} has a map over 80 MB or an empty file.`
          : bytes > setLimit ? `${name} exceeds the 512 MB texture-set limit.` : '';
      output.push({ name, resolution: chosen, files: chosenFiles, skipped: entries.length - chosenFiles.length, bytes, issue });
    }
    return { groups: output, ignored };
  }
  return { plan };
});
