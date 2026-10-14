// Region-aware evidence from a beauty render and KeyShot's Clown pass.
// Clown colors supply a product/object mask; no border-color guess is used.
const fs = require('fs');
const { decode } = require('./png');
const { decode: decodeExr } = require('./exr');

function quantile(sorted, fraction) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * sorted.length)))];
}

function summarizeLinearPass(file, clown) {
  try {
    const image = decodeExr(fs.readFileSync(file.path));
    if (image.width !== clown.w || image.height !== clown.h)
      return { available: false, reason: 'EXR and Clown dimensions do not match.' };
    const red = image.channels.R, green = image.channels.G, blue = image.channels.B;
    const gray = image.channels.Y;
    const product = [], nonProduct = [], labels = new Map();
    const productRgb = [0, 0, 0], nonProductRgb = [0, 0, 0];
    let invalid = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const index = y * image.width + x;
      const rgb = gray ? [gray[index], gray[index], gray[index]] : [red[index], green[index], blue[index]];
      const luma = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      if (!Number.isFinite(luma)) { invalid++; continue; }
      const label = clown.px(x, y);
      const isProduct = Math.max(label[0], label[1], label[2]) > 8;
      (isProduct ? product : nonProduct).push(luma);
      const sums = isProduct ? productRgb : nonProductRgb;
      for (let c = 0; c < 3; c++) sums[c] += rgb[c];
      if (isProduct) {
        const code = (label[0] >= 128 ? 4 : 0) | (label[1] >= 128 ? 2 : 0) | (label[2] >= 128 ? 1 : 0);
        if (code) {
          let item = labels.get(code);
          if (!item) { item = { lumas: [], rgb: [0, 0, 0], x: 0, y: 0, minX: x, minY: y, maxX: x, maxY: y }; labels.set(code, item); }
          item.lumas.push(luma); item.x += x; item.y += y;
          item.minX = Math.min(item.minX, x); item.minY = Math.min(item.minY, y);
          item.maxX = Math.max(item.maxX, x); item.maxY = Math.max(item.maxY, y);
          for (let c = 0; c < 3; c++) item.rgb[c] += rgb[c];
        }
      }
    }
    if (!product.length) return { available: false, reason: 'Clown mask contained no product pixels.' };
    product.sort((a, b) => a - b);
    nonProduct.sort((a, b) => a - b);
    const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const summary = (values, rgbSums) => values.length ? {
      sampled_pixels: values.length,
      mean_luma: +mean(values).toFixed(7),
      mean_rgb: rgbSums.map(value => +(value / values.length).toFixed(7)),
      p50_luma: +quantile(values, 0.50).toFixed(7),
      p95_luma: +quantile(values, 0.95).toFixed(7),
      positive_share: +(values.filter(value => value > 0).length / values.length).toFixed(4)
    } : null;
    return {
      available: true,
      format: 'linear EXR luminance; ZIP tiled single-level pass',
      dimensions: { width: image.width, height: image.height },
      product: summary(product, productRgb),
      non_product: summary(nonProduct, nonProductRgb),
      clown_labels: [...labels.entries()].sort((a, b) => b[1].lumas.length - a[1].lumas.length).map(([code, item]) => {
        item.lumas.sort((a, b) => a - b);
        return {
          rgb_bits: [(code >> 2) & 1, (code >> 1) & 1, code & 1],
          sampled_pixels: item.lumas.length,
          centroid_normalized: { x: +((item.x / item.lumas.length) / image.width).toFixed(4), y: +((item.y / item.lumas.length) / image.height).toFixed(4) },
          bounds_normalized: { x0: +(item.minX / image.width).toFixed(4), y0: +(item.minY / image.height).toFixed(4), x1: +((item.maxX + 1) / image.width).toFixed(4), y1: +((item.maxY + 1) / image.height).toFixed(4) },
          mean_luma: +(item.lumas.reduce((sum, value) => sum + value, 0) / item.lumas.length).toFixed(7),
          p50_luma: +quantile(item.lumas, 0.50).toFixed(7),
          p95_luma: +quantile(item.lumas, 0.95).toFixed(7),
          mean_rgb: item.rgb.map(value => +(value / item.lumas.length).toFixed(7))
        };
      }),
      invalid_pixel_share: +(invalid / (image.width * image.height)).toFixed(6),
      interpretation: 'Non-product includes floor, shadows, and reflections; it is not a pure backdrop region.'
    };
  } catch (error) {
    return { available: false, reason: String(error.message || error).slice(0, 200) };
  }
}

function compareCaptures(referenceFiles, candidateFiles, threshold = 1e-4) {
  const reference = new Map((referenceFiles || []).map(file => [file.pass, file]));
  const candidate = new Map((candidateFiles || []).map(file => [file.pass, file]));
  const referenceClown = reference.get('clown'), candidateClown = candidate.get('clown');
  if (!referenceClown || !candidateClown) return { available: false, reason: 'Both captures need Clown masks for an aligned comparison.' };
  try {
    const maskA = decode(fs.readFileSync(referenceClown.path));
    const maskB = decode(fs.readFileSync(candidateClown.path));
    if (maskA.w !== maskB.w || maskA.h !== maskB.h)
      return { available: false, reason: 'Capture mask dimensions differ; align the camera and render size before comparing.' };

    let productA = 0, productB = 0, intersection = 0, union = 0, maskChanged = 0, labelMatches = 0, labelChanges = 0;
    const productMaskA = new Uint8Array(maskA.w * maskA.h), productMaskB = new Uint8Array(maskB.w * maskB.h);
    const clownCodeA = new Uint8Array(maskA.w * maskA.h), clownCodeB = new Uint8Array(maskB.w * maskB.h);
    for (let y = 0; y < maskA.h; y++) for (let x = 0; x < maskA.w; x++) {
      const i = y * maskA.w + x;
      const labelA = maskA.px(x, y), labelB = maskB.px(x, y);
      const a = Math.max(...labelA) > 8, b = Math.max(...labelB) > 8;
      productMaskA[i] = a ? 1 : 0; productMaskB[i] = b ? 1 : 0;
      clownCodeA[i] = (labelA[0] >= 128 ? 4 : 0) | (labelA[1] >= 128 ? 2 : 0) | (labelA[2] >= 128 ? 1 : 0);
      clownCodeB[i] = (labelB[0] >= 128 ? 4 : 0) | (labelB[1] >= 128 ? 2 : 0) | (labelB[2] >= 128 ? 1 : 0);
      if (a) productA++;
      if (b) productB++;
      if (a || b) union++;
      if (a && b) {
        intersection++;
        if (clownCodeA[i] && clownCodeB[i]) {
          if (clownCodeA[i] === clownCodeB[i]) labelMatches++;
          else labelChanges++;
        }
      }
      if (a !== b) maskChanged++;
    }
    const passResults = {};
    for (const pass of ['direct', 'indirect', 'reflection', 'shadow', 'raw']) {
      const fileA = reference.get(pass), fileB = candidate.get(pass);
      if (!fileA || !fileB || !/\.exr$/i.test(fileA.name || fileA.path || '') || !/\.exr$/i.test(fileB.name || fileB.path || '')) continue;
      try {
        const imageA = decodeExr(fs.readFileSync(fileA.path)), imageB = decodeExr(fs.readFileSync(fileB.path));
        if (imageA.width !== maskA.w || imageA.height !== maskA.h || imageB.width !== maskA.w || imageB.height !== maskA.h) {
          passResults[pass] = { available: false, reason: 'Pass dimensions do not align with the Clown masks.' };
          continue;
        }
        const blank = () => ({ count: 0, signed: 0, absolute: 0, overThreshold: 0, max: 0, rgb: [0, 0, 0], rgbAbsolute: [0, 0, 0] });
        const regions = { product: blank(), non_product: blank() };
        const labelDeltas = new Map();
        const pixelRgb = (image, index) => image.channels.Y
          ? [image.channels.Y[index], image.channels.Y[index], image.channels.Y[index]]
          : [image.channels.R[index], image.channels.G[index], image.channels.B[index]];
        for (let i = 0; i < maskA.w * maskA.h; i++) {
          const isProductA = productMaskA[i] === 1, isProductB = productMaskB[i] === 1;
          if (isProductA !== isProductB) continue; // Exclude silhouette edges if the camera or mask shifted.
          const rgbA = pixelRgb(imageA, i), rgbB = pixelRgb(imageB, i);
          if (![...rgbA, ...rgbB].every(Number.isFinite)) continue;
          const delta = rgbB.map((value, channel) => value - rgbA[channel]);
          const deltaLuma = 0.2126 * delta[0] + 0.7152 * delta[1] + 0.0722 * delta[2];
          const absLuma = Math.abs(deltaLuma), stats = regions[isProductA ? 'product' : 'non_product'];
          stats.count++; stats.signed += deltaLuma; stats.absolute += absLuma;
          if (absLuma > threshold) stats.overThreshold++;
          if (absLuma > stats.max) stats.max = absLuma;
          for (let c = 0; c < 3; c++) { stats.rgb[c] += delta[c]; stats.rgbAbsolute[c] += Math.abs(delta[c]); }
          if (isProductA) {
            const codeA = clownCodeA[i], codeB = clownCodeB[i];
            if (codeA && codeA === codeB) {
              let labelStats = labelDeltas.get(codeA);
              if (!labelStats) { labelStats = blank(); labelDeltas.set(codeA, labelStats); }
              labelStats.count++; labelStats.signed += deltaLuma; labelStats.absolute += absLuma;
              if (absLuma > threshold) labelStats.overThreshold++;
              if (absLuma > labelStats.max) labelStats.max = absLuma;
              for (let c = 0; c < 3; c++) { labelStats.rgb[c] += delta[c]; labelStats.rgbAbsolute[c] += Math.abs(delta[c]); }
            }
          }
        }
        const finish = stats => stats.count ? {
          compared_pixels: stats.count,
          mean_signed_luma_delta: +(stats.signed / stats.count).toFixed(7),
          mean_absolute_luma_delta: +(stats.absolute / stats.count).toFixed(7),
          share_luma_delta_over_threshold: +(stats.overThreshold / stats.count).toFixed(4),
          max_absolute_luma_delta: +stats.max.toFixed(7),
          mean_rgb_delta: stats.rgb.map(value => +(value / stats.count).toFixed(7)),
          mean_absolute_rgb_delta: stats.rgbAbsolute.map(value => +(value / stats.count).toFixed(7))
        } : null;
        passResults[pass] = {
          available: true,
          product: finish(regions.product),
          non_product: finish(regions.non_product),
          clown_labels: [...labelDeltas.entries()].sort((a, b) => b[1].count - a[1].count).map(([code, stats]) => ({
            rgb_bits: [(code >> 2) & 1, (code >> 1) & 1, code & 1], ...finish(stats)
          }))
        };
      } catch (error) {
        passResults[pass] = { available: false, reason: String(error.message || error).slice(0, 160) };
      }
    }
    if (!Object.keys(passResults).length) return { available: false, reason: 'The captures have no matching supported linear EXR passes.' };
    return {
      available: true,
      method: 'Paired linear EXR deltas on pixels where both Clown masks agree',
      dimensions: { width: maskA.w, height: maskA.h },
      mask_agreement: {
        intersection_over_union: +(intersection / Math.max(1, union)).toFixed(4),
        reference_product_pixels: productA,
        candidate_product_pixels: productB,
        shared_product_pixels: intersection,
        changed_mask_share: +(maskChanged / (maskA.w * maskA.h)).toFixed(6),
        suitable_for_lighting_only_comparison: intersection / Math.max(1, union) >= 0.95,
        shared_labeled_pixel_count: labelMatches + labelChanges,
        clown_label_agreement: +((labelMatches / Math.max(1, labelMatches + labelChanges))).toFixed(4),
        suitable_for_per_label_comparison: intersection / Math.max(1, union) >= 0.95 && labelMatches / Math.max(1, labelMatches + labelChanges) >= 0.95
      },
      changed_pixel_threshold_linear_luma: threshold,
      passes: passResults,
      interpretation: 'Positive signed delta means the candidate is brighter than the reference. Pixels where the product mask changed are excluded; large mask disagreement usually means the camera or framing changed.'
    };
  } catch (error) {
    return { available: false, reason: String(error.message || error).slice(0, 200) };
  }
}

function analyzeCapture(files, expected = {}) {
  const byPass = new Map((files || []).map(file => [file.pass, file]));
  const beautyFile = byPass.get('beauty'), clownFile = byPass.get('clown');
  if (!beautyFile || !clownFile) return { available: false, reason: 'Beauty and Clown PNG outputs are both required for product-region analysis.' };
  const beauty = decode(fs.readFileSync(beautyFile.path));
  const clown = decode(fs.readFileSync(clownFile.path));
  if (beauty.w !== clown.w || beauty.h !== clown.h) return { available: false, reason: 'Beauty and Clown dimensions do not match.' };
  if ((expected.width && beauty.w !== expected.width) || (expected.height && beauty.h !== expected.height))
    return { available: false, reason: 'Render dimensions do not match the requested capture.' };

  const step = Math.max(1, Math.floor(Math.max(beauty.w, beauty.h) / 640));
  const lumas = [], backgroundLumas = [], labelCounts = new Map();
  let minX = beauty.w, minY = beauty.h, maxX = -1, maxY = -1;
  let rSum = 0, gSum = 0, bSum = 0, productCount = 0, backgroundCount = 0;
  let leftSum = 0, leftCount = 0, rightSum = 0, rightCount = 0, topSum = 0, topCount = 0, bottomSum = 0, bottomCount = 0;

  for (let y = 0; y < beauty.h; y += step) for (let x = 0; x < beauty.w; x += step) {
    const label = clown.px(x, y);
    const isProduct = Math.max(label[0], label[1], label[2]) > 8;
    const [r, g, b] = beauty.px(x, y);
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (!isProduct) { backgroundLumas.push(luma); backgroundCount++; continue; }
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    productCount++; lumas.push(luma); rSum += r; gSum += g; bSum += b;
    // Quantize flat Clown colors to RGB primaries; this ignores antialiased edge mixtures.
    const code = (label[0] >= 128 ? 4 : 0) | (label[1] >= 128 ? 2 : 0) | (label[2] >= 128 ? 1 : 0);
    labelCounts.set(code, (labelCounts.get(code) || 0) + 1);
  }
  if (!productCount || maxX < minX || maxY < minY) return { available: false, reason: 'Clown pass contained no non-background object pixels.' };

  const spanX = Math.max(1, maxX - minX + 1), spanY = Math.max(1, maxY - minY + 1);
  for (let y = 0; y < beauty.h; y += step) for (let x = 0; x < beauty.w; x += step) {
    const label = clown.px(x, y);
    if (Math.max(label[0], label[1], label[2]) <= 8) continue;
    const [r, g, b] = beauty.px(x, y), luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if ((x - minX) / spanX < 0.5) { leftSum += luma; leftCount++; } else { rightSum += luma; rightCount++; }
    if ((y - minY) / spanY < 0.5) { topSum += luma; topCount++; } else { bottomSum += luma; bottomCount++; }
  }
  lumas.sort((a, b) => a - b); backgroundLumas.sort((a, b) => a - b);
  const highlightCutoff = quantile(lumas, 0.90);
  let highlightCount = 0, highlightX = 0, highlightY = 0, edgeSum = 0, edgeCount = 0, interiorSum = 0, interiorCount = 0;
  const marginX = Math.max(1, spanX * 0.15), marginY = Math.max(1, spanY * 0.15);
  for (let y = 0; y < beauty.h; y += step) for (let x = 0; x < beauty.w; x += step) {
    const label = clown.px(x, y);
    if (Math.max(label[0], label[1], label[2]) <= 8) continue;
    const [r, g, b] = beauty.px(x, y), luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (luma >= highlightCutoff) { highlightCount++; highlightX += x; highlightY += y; }
    const edge = x - minX < marginX || maxX - x < marginX || y - minY < marginY || maxY - y < marginY;
    if (edge) { edgeSum += luma; edgeCount++; } else { interiorSum += luma; interiorCount++; }
  }
  const labels = [...labelCounts.entries()].filter(([code]) => code !== 0).sort((a, b) => b[1] - a[1]).map(([code, count]) => ({
    rgb_bits: [(code >> 2) & 1, (code >> 1) & 1, code & 1], sampled_pixels: count
  }));
  const mean = lumas.reduce((sum, value) => sum + value, 0) / lumas.length;
  const backgroundMean = backgroundLumas.length ? backgroundLumas.reduce((sum, value) => sum + value, 0) / backgroundLumas.length : null;
  const linearPasses = {};
  for (const file of byPass.values()) {
    if (['direct', 'indirect', 'reflection', 'shadow', 'raw'].includes(file.pass) && /\.exr$/i.test(file.name || file.path || ''))
      linearPasses[file.pass] = summarizeLinearPass(file, clown);
  }

  return {
    available: true,
    method: 'Clown non-black mask aligned to beauty render',
    dimensions: { width: beauty.w, height: beauty.h, sample_step: step },
    product_mask: {
      sampled_pixels: productCount,
      image_share: +(productCount / (productCount + backgroundCount)).toFixed(4),
      bounds_normalized: { x0: +(minX / beauty.w).toFixed(4), y0: +(minY / beauty.h).toFixed(4), x1: +((maxX + 1) / beauty.w).toFixed(4), y1: +((maxY + 1) / beauty.h).toFixed(4) },
      dominant_color_labels: labels
    },
    product: {
      mean_luma: +mean.toFixed(4), p05_luma: +quantile(lumas, 0.05).toFixed(4), p50_luma: +quantile(lumas, 0.50).toFixed(4),
      p95_luma: +quantile(lumas, 0.95).toFixed(4), p99_luma: +quantile(lumas, 0.99).toFixed(4),
      crushed_share: +(lumas.filter(value => value <= 8 / 255).length / lumas.length).toFixed(4),
      clipped_share: +(lumas.filter(value => value >= 250 / 255).length / lumas.length).toFixed(4),
      mean_rgb: [rSum, gSum, bSum].map(value => +(value / productCount / 255).toFixed(4)),
      warm_cool_delta: +((rSum - bSum) / productCount / 255).toFixed(4),
      left_right_luma_delta: +((leftSum / Math.max(1, leftCount)) - (rightSum / Math.max(1, rightCount))).toFixed(4),
      top_bottom_luma_delta: +((topSum / Math.max(1, topCount)) - (bottomSum / Math.max(1, bottomCount))).toFixed(4),
      edge_interior_luma_delta: +((edgeSum / Math.max(1, edgeCount)) - (interiorSum / Math.max(1, interiorCount))).toFixed(4),
      highlight_share: +(highlightCount / productCount).toFixed(4),
      highlight_centroid_normalized: { x: +((highlightX / Math.max(1, highlightCount)) / beauty.w).toFixed(4), y: +((highlightY / Math.max(1, highlightCount)) / beauty.h).toFixed(4) }
    },
    outside_mask: {
      sampled_pixels: backgroundCount,
      mean_luma: backgroundMean == null ? null : +backgroundMean.toFixed(4),
      p50_luma: backgroundLumas.length ? +quantile(backgroundLumas, 0.50).toFixed(4) : null,
      interpretation: 'Includes backdrop, floor, shadows, and reflections; it is not a pure background mask.'
    },
    linear_passes: linearPasses,
    limitations: ['The Clown non-black mask identifies rendered labels, not semantic product parts.', 'Ground shadows and reflections remain outside the product mask and should be scored as separate regions.']
  };
}

module.exports = { analyzeCapture, compareCaptures };
