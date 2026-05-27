const breakpoints = [
  { lo: 0,     hi: 12.0,   aqiLo: 0,   aqiHi: 50,  category: 'Buena',                       color: '#00e400' },
  { lo: 12.1,  hi: 35.4,   aqiLo: 51,  aqiHi: 100, category: 'Moderada',                    color: '#ffff00' },
  { lo: 35.5,  hi: 55.4,   aqiLo: 101, aqiHi: 150, category: 'Dañina para grupos sensibles', color: '#ff7e00' },
  { lo: 55.5,  hi: 150.4,  aqiLo: 151, aqiHi: 200, category: 'Dañina',                      color: '#ff0000' },
  { lo: 150.5, hi: 250.4,  aqiLo: 201, aqiHi: 300, category: 'Muy dañina',                  color: '#8f3f97' },
  { lo: 250.5, hi: 500.4,  aqiLo: 301, aqiHi: 500, category: 'Peligrosa',                   color: '#7e0023' }
];

function calculateAQI(pm25) {
  const c = Math.round(pm25 * 10) / 10;
  for (const bp of breakpoints) {
    if (c >= bp.lo && c <= bp.hi) {
      const aqi = Math.round(((bp.aqiHi - bp.aqiLo) / (bp.hi - bp.lo)) * (c - bp.lo) + bp.aqiLo);
      return { aqi, category: bp.category, color: bp.color };
    }
  }
  return { aqi: 500, category: 'Peligrosa', color: '#7e0023' };
}

module.exports = { calculateAQI };
