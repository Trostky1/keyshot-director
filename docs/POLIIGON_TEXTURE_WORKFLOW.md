# Poliigon assets in KeyShot

Use Poliigon's Download Settings to select KeyShot before downloading. This helps Poliigon include the KeyShot-compatible model and texture files.

## Models

In KeyShot, choose **Import** from the bottom toolbar and import the downloaded `.fbx`. Poliigon texture maps are separate files, so skip texture options in the FBX import dialog when the maps will be connected manually.

## PBR textures

This section describes manual KeyShot workflows. KeyShot Material Graph and supported map sockets vary by material model. Set Base Color as sRGB and scalar or vector data as linear only after checking the map and shader settings.

KeyShot displacement and layered metallic graphs can affect geometry, performance, and graph complexity. KeyShot Director's current texture-set builder does not create those graphs. Use its simple Plastic route with Base Color, Roughness, Normal or Bump, and optional AO; use native KeyShot controls for other workflows.

## HDRIs

In the Library panel, open **Environments** and use the folder/import control to add the downloaded HDRI. Double-click it to assign it, then adjust rotation, brightness, blur and scale under **Project → Environment**. Use **HDRI Editor** when you need to place or tune environment pins.

## KeyShot Director texture sets

Use **Materials → Import Poliigon download folder** and select the product folder or one resolution folder, such as `2K`. The importer selects one resolution, skips previews and duplicates, recognizes both current map labels and common legacy `DISP16`/`NRM16`/`BUMP16` names, records supported image-header dimensions and bit depth for newly imported maps, and preserves original files under `materials/texture-sets/`. New sets support up to 24 files, 80 MB per file, and 512 MB total. A `.mtlx` is retained and parsed for limited hints; it is not directly executed or translated as an arbitrary KeyShot graph.

**Build KeyShot material** creates an unassigned simple Plastic material. It uses available Base Color, Roughness, one Normal or Bump map, and optional AO blended into Base Color. A missing map referenced by MaterialX does not block building from the available supported maps. Metallic, Displacement, Specular, Glossiness, and arbitrary MaterialX graph wiring are paused or unsupported; each skipped file is reported. The package is saved to KeyShot's Director library and exported as a KMP. Original source maps remain unchanged.

Check the Plastic surface and map connections in KeyShot Material Graph. Confirm texture scale and placement on the intended model, then drag the saved material onto that part. KeyShot 2026.2 is the current supported target; map color transfer and rendered scale still need live checks on the actual product and computer.
## Variations from the KeyShot Material Library

In Material Lab, search the actual KeyShot library and select an entry. Select the intended geometry in KeyShot, then use **Copy to selected part**. KeyShot creates an unlinked scene copy on the selected geometry; Director edits only this copy and leaves the source library entry unchanged. Describe the desired variation to Material Director. It can update exposed numeric, boolean and color parameters, then save the copy under KeyShot's Material Library → Director and as a project-local `.kmp`. Texture connections and graph structure remain unchanged. This route requires selected geometry because KeyShot's scripting API creates the independent copy by applying the library material to an object with linking disabled.
