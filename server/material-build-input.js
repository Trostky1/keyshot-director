'use strict';

const SUPPORTED_ROLES = new Set(['base-color', 'roughness', 'normal', 'bump']);
const SELECTABLE_ROLES = new Set([...SUPPORTED_ROLES, 'ambient-occlusion']);

function selectMaterialBuildInputs(files, { selected_files, use_ao = true, tile_size_mm = 41 } = {}) {
  if (!Array.isArray(files)) throw new Error('Texture set has no readable file list.');
  if (typeof use_ao !== 'boolean') throw new Error('AO selection must be on or off.');
  if (typeof tile_size_mm !== 'number' || !Number.isFinite(tile_size_mm) || tile_size_mm < 1 || tile_size_mm > 2000)
    throw new Error('Texture tile size must be between 1 and 2000 mm.');

  let recipeFiles = files.filter(file => (use_ao || file.role !== 'ambient-occlusion') && SELECTABLE_ROLES.has(file.role));
  if (selected_files !== undefined) {
    if (!Array.isArray(selected_files) || selected_files.length > 5 || !selected_files.every(file => file &&
      typeof file === 'object' && !Array.isArray(file) && typeof file.name === 'string' && typeof file.role === 'string'))
      throw new Error('Choose up to five supported maps from this texture set.');
    const roles = new Set();
    recipeFiles = selected_files.map(({ name, role }) => {
      if (roles.has(role) || !SELECTABLE_ROLES.has(role) || (role === 'ambient-occlusion' && !use_ao))
        throw new Error(`Invalid or repeated map role: ${role}`);
      roles.add(role);
      const file = files.find(item => item.name === name && item.role === role);
      if (!file) throw new Error(`Selected ${role} map is missing from this texture set. Refresh and choose it again.`);
      return file;
    });
    if (roles.has('normal') && roles.has('bump'))
      throw new Error('Choose either a Normal map or a Bump map for surface detail.');
  }
  if (!recipeFiles.some(file => SUPPORTED_ROLES.has(file.role)))
    throw new Error('Choose at least one Base Color, Roughness, Normal, or Bump map.');
  return { recipeFiles, tile_size_mm };
}

module.exports = { selectMaterialBuildInputs };
