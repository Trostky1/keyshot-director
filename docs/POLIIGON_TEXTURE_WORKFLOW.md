# Poliigon assets in KeyShot

Use Poliigon's Download Settings to select KeyShot before downloading. This helps Poliigon include the KeyShot-compatible model and texture files.

## Models

In KeyShot, choose **Import** from the bottom toolbar and import the downloaded `.fbx`. Poliigon texture maps are separate files, so skip texture options in the FBX import dialog when the maps will be connected manually.

## PBR textures

1. Select the target model in the Project panel under **Scene**.
2. Open **Project → Material**, then double-click the assigned material or its entry in the Materials list.
3. Set **Type** to **Advanced**, then open **Material Graph**.
4. Drag the maps from the extracted Poliigon folder into the graph. Use one **Mapping 2D** node to control the shared UV mapping: connect it to each texture map's **UV Mapping** input and set each texture's Mapping Type to **Node**.
5. Connect maps according to their role:
   - Base Color / Albedo → Advanced **Diffuse**
   - Roughness → **Color To Number** → Advanced **Roughness**
   - Normal → Advanced **Bump**; Poliigon's guide recommends a negative normal strength for its maps
   - Displacement / Height → **Displace** node → root Material **Geometry** input
   - Specular → Advanced **Specular**, when supplied
6. For mixed metal and rust, use the guide's layered setup: a Metal base with a Plastic label, and an inverted Metalness map driving the Plastic label's opacity. Inspect the map convention and preview the result; the mask polarity depends on which material should show through.

KeyShot displacement changes geometry and may need suitable tessellation settings and mesh density. Start with a conservative height and inspect a preview before rendering.

## HDRIs

In the Library panel, open **Environments** and use the folder/import control to add the downloaded HDRI. Double-click it to assign it, then adjust rotation, brightness, blur and scale under **Project → Environment**. Use **HDRI Editor** when you need to place or tune environment pins.

## KeyShot Director texture sets

Use **Materials → Import Poliigon download folder** and select the product folder or one resolution folder, such as `2K`. The importer reads channel names, selects one resolution when multiple folders are included, excludes preview images, and preserves the original files under `materials/texture-sets/`. A `.mtlx` is retained as metadata but is not directly executed or translated as a graph. Select the target part in KeyShot, then use **Build & apply to selection**. Director creates an Advanced graph with one shared Mapping 2D node and connects Base Color, Roughness/Glossiness, Specular, Normal/Bump, Displacement, and a layered Metal/Plastic label for Metalness when those maps exist. It saves the material under KeyShot's Material Library → Director and exports a `.kmp` under the project `materials/` folder. It applies only to the selected KeyShot geometry. AO and arbitrary MaterialX graphs are retained locally but not converted.

## Variations from the KeyShot Material Library

In Material Lab, search the actual KeyShot library and select an entry. Select the intended geometry in KeyShot, then use **Copy to selected part**. KeyShot creates an unlinked scene copy on the selected geometry; Director edits only this copy and leaves the source library entry unchanged. Describe the desired variation to Material Director. It can update exposed numeric, boolean and color parameters, then save the copy under KeyShot's Material Library → Director and as a project-local `.kmp`. Texture connections and graph structure remain unchanged. This route requires selected geometry because KeyShot's scripting API creates the independent copy by applying the library material to an object with linking disabled.
