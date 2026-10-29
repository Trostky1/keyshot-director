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

Use **Materials → Texture sets → Import downloaded folder** and select one asset folder or a parent folder of several assets you downloaded through Poliigon. Choose the preferred resolution first; the importer keeps one available resolution per asset, plus files without a resolution label. It skips previews, unsupported files and duplicate filenames, and reports the skipped count. Each asset becomes a separate texture set. The optional name applies when importing one asset. The importer recognizes current map labels and common legacy `DISP16`/`NRM16`/`BUMP16` names, records supported image-header dimensions and bit depth for newly imported maps, and preserves original files under `materials/texture-sets/`. Each set supports up to 24 files, 80 MB per file, and 512 MB total; assets that exceed these limits are reported for review. A `.mtlx` is retained and parsed for limited hints; it is not directly executed or translated as an arbitrary KeyShot graph.

There is no Poliigon website API connection in Director. Poliigon's [current terms](https://www.poliigon.com/terms) require prior written consent to use its API, and its [Unlimited plan guidance](https://help.poliigon.com/en/articles/10003983-how-unlimited-plans-work) prohibits scripts that download or mirror large parts of the library. Until Poliigon grants permission and supplies the supported API details, use its website or official plugin to obtain specific assets for your projects, then import those local downloads here. Keep source maps private and out of release packages.

Before **Build KeyShot material**, choose the exact Base Color, Roughness, Surface detail (Normal or Bump), and optional AO files. Set the physical texture tile size in millimeters; the starting value is 41 mm. This creates an unassigned simple Plastic material from the chosen files. A missing map referenced by MaterialX does not block building from the available supported maps. Metallic, Displacement, Specular, Glossiness, and arbitrary MaterialX graph wiring are paused or unsupported; each skipped file is reported. The package is saved to KeyShot's Director library and exported as a KMP. A JSON build receipt under `materials/build-receipts/` records the selection and result. Original source maps remain unchanged.

Check the Plastic surface and map connections in KeyShot Material Graph. Confirm texture scale and placement on the intended model, then drag the saved material onto that part. KeyShot 2026.2 is the current supported target; map color transfer and rendered scale still need live checks on the actual product and computer.
## Variations from the KeyShot Material Library

In Material Lab, search the actual KeyShot library and select an entry. Select the intended geometry in KeyShot, then use **Copy to selected part**. KeyShot creates an unlinked scene copy on the selected geometry; Director edits only this copy and leaves the source library entry unchanged. Describe the desired variation to Material Director. It can update exposed numeric, boolean and color parameters, then save the copy under KeyShot's Material Library → Director and as a project-local `.kmp`. Texture connections and graph structure remain unchanged. This route requires selected geometry because KeyShot's scripting API creates the independent copy by applying the library material to an object with linking disabled.
