# Human Atlas

A separate, interactive anatomy studio with selectable male and female reference models and a continuous assembled-to-exploded view. The male collection contains 2,234 meshes and 3,432 named concepts; the female collection contains 888 meshes and 1,073 selectable source nodes.

## Explore

- Choose male or female anatomy; the geometry, catalogue, and available systems change together.
- Orbit the body, pinch or scroll to zoom, and tap anatomy to identify a structure.
- Toggle systems, show only one system, or switch between skeleton and organ presets.
- Search official names and source atlas identifiers; compound concepts select their full mesh set.
- Isolate and automatically frame selected structures.
- Expand the entire visible anatomy into individually spaced pieces.
- Phone layouts use compact touch controls and panels that leave room for the anatomy.

## Local development

Node 22.13+ is required. Run `npm ci`, then `npm run dev` (port 3016). `npm run check` checks TypeScript and `npm run build` creates the static Vite site. `node scripts/validate-atlas.mjs` validates every mesh buffer and concept membership.

## Data and scope

BodyParts3D 4.0 adult male anatomy and Human Reference Atlas united-female v1.5, both licensed CC BY 4.0. All source meshes are preserved, with geometry simplified for browser performance. See [full attribution](public/ATTRIBUTION.md). Anatomy varies between people and neither dataset represents every human structure. The female collection includes reproductive anatomy, whole-body surface, and selected organs; skeleton and muscle coverage is partial. Eight pregnancy reference pieces are hidden by default in a separate layer.

The manifest retains source IDs, English anatomical names, mesh bounds, and compound concept membership. The UI uses curated display categories. Descriptions explicitly distinguish general system context from available individual organ explanations; the dataset itself does not provide prose definitions.

## Renderer

Indexed geometry is merged into batches; a per-structure GPU texture controls translation, selection and visibility. Only visible interactions trigger a render. The original component geometries remain available for accurate click selection without thousands of draw calls. Shadows are not recalculated for every anatomical part.

## Rebuilding assets

Download the official BodyParts3D OBJ archive and English metadata tables, prepare joined concepts and display system mappings, run `scripts/convert-anatomy.py`, then `node scripts/optimize-anatomy.mjs`. The latter preserves each source mesh and limits simplification error to 0.2% of the individual mesh extent. Final assets contain 2,288,268 triangles in approximately 33 MB compressed across progressively loaded chunks. The female collection contains 1,810,038 triangles. Use `scripts/convert-female.py`, then `node scripts/optimize-anatomy.mjs atlas-female.json` to rebuild it. Run `node scripts/compress-models.mjs` after either conversion.

## Deployment

This project has its own Git repository and Vercel configuration. It is independent of Model X Studio.

## Validation

Run `npm run check`, `npm run build`, `node scripts/validate-atlas.mjs`, `node scripts/validate-atlas.mjs atlas-female.json`, and `node scripts/validate-interactions.mjs`. Data checks cover every mesh buffer, labels, bounds, and source concept membership. Interaction checks cover nonoverlapping visible-part packing at three aspect ratios, search/inspection contracts, and tap-versus-drag/multitouch handling.

The functionality audit exercised both reference models, system presets and switches, full explosion, direct selection, search, isolation, detail dismissal, rotation, and a 390×844 phone layout in the browser. Native WebMCP search and inspection were also exercised. Physical-device GPU performance and real multitouch hardware have not been tested.

The subsequent visual refresh uses neutral lighting and shadcn buttons, badges, selects, switches, sliders, and sheets. Final visual revalidation depends on browser availability.
