/** Compress a selected image without changing its proportions. */
export async function coverFromFile(file, sides = [960, 720, 512, 384]) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Elige una imagen.');
  if (file.size > 15 * 1024 * 1024) throw new Error('La imagen supera los 15 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    // An image with transparent parts (a PNG or WebP logo) keeps them: as PNG, or WebP if PNG is too big,
    // smaller each time; JPEG, which has no transparency and turned them black, only for opaque images.
    for (const side of sides) {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const transparent = file.type !== 'image/jpeg' && hasTransparency(context.getImageData(0, 0, canvas.width, canvas.height).data);
      const tries = transparent ? [['image/png'], ['image/webp', .85], ['image/webp', .65]] : [['image/jpeg', .8], ['image/jpeg', .65], ['image/jpeg', .5], ['image/jpeg', .35]];
      for (const [type, quality] of tries) {
        const data = canvas.toDataURL(type, quality);
        // A browser without WebP output answers with PNG: still transparent.
        if (data.length <= 130000 && data.startsWith('data:image/' + type.slice(6))) return data;
        if (data.length <= 130000 && transparent && data.startsWith('data:image/png')) return data;
      }
    }
    throw new Error('La imagen es demasiado compleja. Usa una más pequeña o un enlace HTTPS.');
  } finally { bitmap.close(); }
}

function hasTransparency(rgba) {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) return true;
  return false;
}
