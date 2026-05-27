const fs = require('fs');
const path = require('path');

function generateSVG(size) {
  const r = size * 0.42;
  const cx = size / 2;
  const cy = size / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${size * 0.18}" fill="#0f1923"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#00b4d8" stroke-width="${size * 0.03}"/>
  <circle cx="${cx}" cy="${cy * 0.75}" r="${size * 0.06}" fill="#00e400"/>
  <circle cx="${cx * 0.7}" cy="${cy * 1.15}" r="${size * 0.05}" fill="#ffff00"/>
  <circle cx="${cx * 1.3}" cy="${cy * 1.15}" r="${size * 0.05}" fill="#ff7e00"/>
  <text x="${cx}" y="${cy * 1.55}" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="${size * 0.12}" fill="#00b4d8">AirSim</text>
  <path d="M${cx - r * 0.5} ${cy * 0.55} Q${cx} ${cy * 0.35} ${cx + r * 0.5} ${cy * 0.55}" fill="none" stroke="#00b4d8" stroke-width="${size * 0.015}" opacity="0.5"/>
</svg>`;
}

const iconsDir = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

for (const size of [192, 512]) {
  const svg = generateSVG(size);
  fs.writeFileSync(path.join(iconsDir, `icon-${size}.svg`), svg);
  console.log(`Generado icon-${size}.svg`);
}

console.log('\nNota: Los SVG fueron generados. Para PWA completa en producción,');
console.log('convierte a PNG con: npx sharp-cli -i public/icons/icon-192.svg -o public/icons/icon-192.png');
console.log('O usa los SVG directamente actualizando manifest.json con type "image/svg+xml".');
