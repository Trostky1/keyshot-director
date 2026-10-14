# Poliigon assets in KeyShot

Use Poliigon's Download Settings to select KeyShot before downloading. This helps Poliigon include the KeyShot-compatible model and texture files.

## Models

In KeyShot, choose **Import** from the bottom toolbar and import the downloaded `.fbx`. Poliigon texture maps are separate files, so skip texture options in the FBX import dialog when the maps will be connected manually.

## PBR textures

1. Select the target model in the Project panel under **Scene**.
2. Open **Project → Material**, then double-click the assigned material or its entry in the Materials list.
3. Choose a material type whose sockets support the intended maps, then open **Material Graph**.
4. Drag the maps from the extracted Poliigon folder into the graph. For consistent tiling, use a shared **Mapping 2D** node and connect every map to its **UV Mapping** input; set each texture's Mapping Type to **Node**.
5. Connect maps according to their role: Base Color to Diffuse, Roughness through Color To Number when needed, Metallic to the shader's metalness input, Normal to Bump, and Displacement to a Displace node connected to root **Geometry**. Use Base Color as sRGB and scalar/vector maps as raw linear data.
6. Poliigon documents its Normal maps as OpenGL. Keep normal data linear, inspect the render, and do not apply a blanket strength or channel inversion rule across assets.
7. Poliigon displacement uses mid-gray as the flat midpoint. Set the Displace node's zero-height/offset control so that midpoint remains on the base surface. Choose a conservative height for the actual product scale and review tessellation. Run **Execute Geometry** after editing the node.
8. For mixed metal and rust, a layered Metal/Plastic label may be appropriate. Treat the mask polarity and graph topology as asset-specific and verify a live material graph before copying that recipe.

KeyShot displacement changes the evaluated geometry rather than only shading. It remains non-destructive, but needs **Execute Geometry** after changes. Hard edges can split, Render NURBS mode does not support geometry nodes, and dense displacement can make scenes heavier. Start with a conservative height and inspect a preview before rendering.

## HDRIs

In the Library panel, open **Environments** and use the folder/import control to add the downloaded HDRI. Double-click it to assign it, then adjust rotation, brightness, blur and scale under **Project → Environment**. Use **HDRI Editor** when you need to place or tune environment pins.

## KeyShot Director texture sets

Use **Materials → Import Poliigon download folder** and select the product folder or one resolution folder, such as `2K`. The importer selects one resolution, skips previews and duplicates, recognizes both current map labels and common legacy `DISP16`/`NRM16`/`BUMP16` names, records supported image-header dimensions and bit depth for newly imported maps, and preserves original files under `materials/texture-sets/`. New sets support up to 24 files, 80 MB per file, and 512 MB total. A `.mtlx` is retained and parsed for limited hints; it is not directly executed or translated as an arbitrary KeyShot graph.

**Build KeyShot material** creates a new unassigned Plastic or Generic graph. Supported channels are Base Color, Roughness, Metallic on Generic, one Normal-or-Bump map, AO Multiply, and true Displace geometry when those maps exist. A recognizable Poliigon displacement map gets `offset=0.5` as a reasoned midpoint-neutral starting value; this still needs live render calibration. REA found that KeyShot exposes UV scale, repeat, shift, mapping and texture-space parameters on Texture Map nodes, but Director does not yet set them. Physical tile size, Specular, ORM splitting, opacity and arbitrary MaterialX topology are not yet reproduced. The package is saved to KeyShot's Director library and exported as a KMP; the source maps remain unchanged. Drag the material onto one intended KeyShot part. Then ask Material Director to execute the named material's geometry nodes; the bridge refuses shared assignments and requires the one assigned part to be visible and unlocked. See [the current materials/displacement investigation](MATERIALS_AND_DISPLACEMENT_DEEP_DIVE.md) for evidence and remaining calibration questions.

## Variations from the KeyShot Material Library

In Material Lab, search the actual KeyShot library and select an entry. Select the intended geometry in KeyShot, then use **Copy to selected part**. KeyShot creates an unlinked scene copy on the selected geometry; Director edits only this copy and leaves the source library entry unchanged. Describe the desired variation to Material Director. It can update exposed numeric, boolean and color parameters, then save the copy under KeyShot's Material Library → Director and as a project-local `.kmp`. Texture connections and graph structure remain unchanged. This route requires selected geometry because KeyShot's scripting API creates the independent copy by applying the library material to an object with linking disabled.
