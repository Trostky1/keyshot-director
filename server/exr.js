// Small, bounded OpenEXR reader for KeyShot's single-level tiled ZIP render passes.
// Unsupported EXR variants fail explicitly so evidence reports can degrade gracefully.
const zlib = require('zlib');

const MAGIC = 20000630;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_PIXELS = 4_000_000;

function halfToFloat(bits) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return sign * Math.pow(2, -14) * (fraction / 1024);
  if (exponent === 0x1f) return fraction ? NaN : sign * Infinity;
  return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
}

function decode(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16 || buffer.length > MAX_FILE_BYTES)
    throw new Error('EXR file is empty, truncated, or larger than the supported limit.');
  if (buffer.readUInt32LE(0) !== MAGIC) throw new Error('File is not an OpenEXR image.');

  let position = 8;
  const attributes = new Map();
  function readString() {
    const end = buffer.indexOf(0, position);
    if (end < 0) throw new Error('EXR header contains an unterminated string.');
    const value = buffer.toString('ascii', position, end);
    position = end + 1;
    return value;
  }
  function requireBytes(count) {
    if (!Number.isInteger(count) || count < 0 || position + count > buffer.length)
      throw new Error('EXR header or pixel chunk is truncated.');
  }

  while (position < buffer.length && buffer[position] !== 0) {
    const name = readString();
    const type = readString();
    requireBytes(4);
    const size = buffer.readUInt32LE(position);
    position += 4;
    requireBytes(size);
    if (attributes.has(name)) throw new Error(`EXR contains duplicate ${name} attributes.`);
    attributes.set(name, { type, data: buffer.subarray(position, position + size) });
    position += size;
  }
  requireBytes(1);
  position += 1;

  function attribute(name, expectedType, expectedSize) {
    const item = attributes.get(name);
    if (!item || item.type !== expectedType || (expectedSize != null && item.data.length !== expectedSize))
      throw new Error(`EXR ${name} attribute is missing or unsupported.`);
    return item.data;
  }

  const window = attribute('dataWindow', 'box2i', 16);
  const minX = window.readInt32LE(0), minY = window.readInt32LE(4);
  const maxX = window.readInt32LE(8), maxY = window.readInt32LE(12);
  const width = maxX - minX + 1, height = maxY - minY + 1;
  if (width < 1 || height < 1 || width * height > MAX_PIXELS)
    throw new Error('EXR dimensions are outside the supported bounds.');

  if (attribute('compression', 'compression', 1)[0] !== 3)
    throw new Error('Only ZIP-compressed EXR passes are supported.');
  const tile = attribute('tiles', 'tiledesc', 9);
  const tileWidth = tile.readUInt32LE(0), tileHeight = tile.readUInt32LE(4);
  if (!tileWidth || !tileHeight || (tile[8] & 0x0f) !== 0)
    throw new Error('Only single-level tiled EXR passes are supported.');

  const channelData = attribute('channels', 'chlist');
  const channels = [];
  let channelPosition = 0;
  while (channelPosition < channelData.length && channelData[channelPosition] !== 0) {
    const nameEnd = channelData.indexOf(0, channelPosition);
    if (nameEnd < 0 || nameEnd + 17 > channelData.length) throw new Error('EXR channel list is malformed.');
    const name = channelData.toString('ascii', channelPosition, nameEnd);
    channelPosition = nameEnd + 1;
    const pixelType = channelData.readInt32LE(channelPosition);
    const xSampling = channelData.readInt32LE(channelPosition + 8);
    const ySampling = channelData.readInt32LE(channelPosition + 12);
    channelPosition += 16;
    if (pixelType !== 1 && pixelType !== 2) throw new Error(`EXR ${name} channel uses an unsupported pixel type.`);
    if (xSampling !== 1 || ySampling !== 1) throw new Error(`EXR ${name} channel uses unsupported subsampling.`);
    channels.push({ name, bytes: pixelType === 1 ? 2 : 4 });
  }
  if (!channels.length) throw new Error('EXR contains no channels.');
  const hasRgb = ['R', 'G', 'B'].every(name => channels.some(channel => channel.name === name));
  const hasLuma = channels.some(channel => channel.name === 'Y');
  if (!hasRgb && !hasLuma) throw new Error('EXR has neither RGB nor luminance channels.');

  const firstTileX = Math.floor(minX / tileWidth), lastTileX = Math.floor(maxX / tileWidth);
  const firstTileY = Math.floor(minY / tileHeight), lastTileY = Math.floor(maxY / tileHeight);
  const tileCount = (lastTileX - firstTileX + 1) * (lastTileY - firstTileY + 1);
  if (!Number.isSafeInteger(tileCount) || tileCount < 1 || position + tileCount * 8 > buffer.length)
    throw new Error('EXR tile offset table is truncated or invalid.');

  const planes = Object.fromEntries(channels.map(channel => [channel.name, new Float32Array(width * height)]));
  const offsetsStart = position;
  const channelBytesPerPixel = channels.reduce((sum, channel) => sum + channel.bytes, 0);

  for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
    const offsetBig = buffer.readBigUInt64LE(offsetsStart + tileIndex * 8);
    if (offsetBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('EXR tile offset is too large.');
    const offset = Number(offsetBig);
    if (offset < position + tileCount * 8 || offset + 20 > buffer.length)
      throw new Error('EXR tile offset points outside the pixel data.');
    const tileX = buffer.readInt32LE(offset), tileY = buffer.readInt32LE(offset + 4);
    const levelX = buffer.readInt32LE(offset + 8), levelY = buffer.readInt32LE(offset + 12);
    const compressedBytes = buffer.readUInt32LE(offset + 16);
    if (levelX !== 0 || levelY !== 0) throw new Error('Multi-level EXR tiles are unsupported.');
    if (compressedBytes > buffer.length - offset - 20) throw new Error('EXR tile data is truncated.');

    const tileMinX = tileX * tileWidth, tileMinY = tileY * tileHeight;
    const startX = Math.max(minX, tileMinX), endX = Math.min(maxX, tileMinX + tileWidth - 1);
    const startY = Math.max(minY, tileMinY), endY = Math.min(maxY, tileMinY + tileHeight - 1);
    const actualWidth = endX - startX + 1, actualHeight = endY - startY + 1;
    if (actualWidth < 1 || actualHeight < 1) throw new Error('EXR tile lies outside the data window.');
    const expectedBytes = actualWidth * actualHeight * channelBytesPerPixel;
    let predicted;
    try {
      predicted = zlib.inflateSync(buffer.subarray(offset + 20, offset + 20 + compressedBytes), { maxOutputLength: expectedBytes });
    } catch {
      throw new Error('EXR ZIP tile could not be decompressed.');
    }
    if (predicted.length !== expectedBytes) throw new Error('EXR ZIP tile has an unexpected decoded size.');

    // Reverse OpenEXR's byte predictor, then undo its even/odd byte shuffle.
    for (let i = 1; i < predicted.length; i++) predicted[i] = (predicted[i - 1] + predicted[i] - 128) & 0xff;
    const raw = Buffer.allocUnsafe(predicted.length);
    const firstHalf = Math.ceil(predicted.length / 2);
    for (let i = 0; i < firstHalf; i++) {
      raw[i * 2] = predicted[i];
      if (i * 2 + 1 < raw.length) raw[i * 2 + 1] = predicted[firstHalf + i];
    }

    const rowBytes = actualWidth * channelBytesPerPixel;
    let channelOffset = 0;
    const channelOffsets = channels.map(channel => {
      const current = channelOffset;
      channelOffset += actualWidth * channel.bytes;
      return current;
    });
    for (let y = 0; y < actualHeight; y++) {
      for (let c = 0; c < channels.length; c++) {
        const channel = channels[c], source = y * rowBytes + channelOffsets[c];
        const destination = (startY - minY + y) * width + (startX - minX);
        const plane = planes[channel.name];
        for (let x = 0; x < actualWidth; x++) {
          const sample = source + x * channel.bytes;
          plane[destination + x] = channel.bytes === 2
            ? halfToFloat(raw.readUInt16LE(sample))
            : raw.readFloatLE(sample);
        }
      }
    }
  }

  return { width, height, channels: planes, channel_names: channels.map(channel => channel.name) };
}

module.exports = { decode };
