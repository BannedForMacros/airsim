# AirSim Monsefú — Plataforma de Monitoreo y Simulación de Calidad del Aire Urbano

**MVP Universitario** · PWA instalable · Monolito Node.js + Express + MongoDB

## Descripción

Sistema web progresivo (PWA) que monitorea y simula la calidad del aire en el eje vial Monsefú–Chalpón–Ciudad Eten, Lambayeque, Perú. Incluye:

- **5 estaciones virtuales** con sensores simulados (PM2.5, PM10, NO₂, O₃, CO, temperatura, humedad)
- **Cálculo de AQI** según breakpoints EPA para PM2.5
- **Predicción temporal** por regresión lineal simple (+1h, +2h)
- **Mapa de dispersión** por interpolación IDW (Inverse Distance Weighting)
- **Alertas automáticas** para población vulnerable
- **Rutas saludables** con exposición estimada por modo de transporte
- **Funciona offline** como PWA instalable en móviles y escritorio

## ¿Por qué sensores simulados?

Este es un MVP académico sin acceso a hardware IoT. La red de sensores se **simula por software** mediante un generador que produce lecturas realistas con:

- Perfiles base por tipo de zona (urbano, periurbano, rural, costero)
- Random walk acotado (variación suave, no ruido aleatorio puro)
- Ciclo diario con picos en horas punta (7-9h y 18-20h)
- Correlación con el clima costero de Lambayeque

La arquitectura está **preparada para IoT**: reemplazar el generador por un endpoint que reciba datos de sensores reales (ESP32, LoRa, etc.) requiere cambios mínimos.

## Stack Tecnológico

| Componente | Tecnología |
|---|---|
| Backend | Node.js + Express |
| Base de datos | MongoDB (Mongoose ODM) |
| Frontend | HTML/CSS/JS vanilla (servido por Express) |
| Mapa | Leaflet + OpenStreetMap (sin API key) |
| Gráficos | Chart.js (CDN) |
| PWA | Service Worker + Web App Manifest |
| Tiempo real | Polling cada 10 segundos |

## Instalación

### 1. Requisitos previos

- **Node.js** 18+ instalado
- **MongoDB Atlas** (gratuito) o MongoDB local

### 2. Obtener MongoDB URI (Atlas gratuito)

1. Ir a [https://cloud.mongodb.com](https://cloud.mongodb.com) y crear cuenta gratuita
2. Crear un cluster (Shared/Free tier M0)
3. En "Database Access": crear usuario con contraseña
4. En "Network Access": agregar `0.0.0.0/0` (permitir cualquier IP)
5. En "Connect" > "Connect your application": copiar la URI
6. Reemplazar `<password>` con la contraseña del usuario

### 3. Configurar el proyecto

```bash
# Clonar o descargar el proyecto
cd airsim-monsefu

# Instalar dependencias
npm install

# Crear archivo .env
cp .env.example .env
# Editar .env y pegar tu MONGODB_URI
```

### 4. Ejecutar

```bash
# IMPORTANTE: Ejecutar seed el mismo día de la demostración,
# justo antes de iniciar el servidor, para que el historial esté actualizado.

# Paso 1: Sembrar 6 horas de datos históricos
npm run seed

# Paso 2: Iniciar el servidor
npm start
```

Abrir **http://localhost:3000** en el navegador.

### 5. Instalar como PWA (opcional)

En Chrome/Edge: al abrir la app aparecerá un ícono de "Instalar" en la barra de direcciones. En móviles: "Agregar a pantalla de inicio".

## Estructura del Proyecto

```
├── server/
│   ├── index.js              # Entrada: Express + MongoDB + sirve /public
│   ├── routes/api.js         # Endpoints REST
│   ├── models/
│   │   ├── Station.js        # Esquema de estaciones
│   │   └── Reading.js        # Esquema de lecturas de sensores
│   ├── simulation/
│   │   └── simulator.js      # Generador de sensores simulados
│   └── prediction/
│       ├── aqi.js            # Cálculo AQI (breakpoints EPA)
│       ├── regression.js     # Regresión lineal para predicción temporal
│       └── idw.js            # Interpolación IDW para predicción espacial
├── public/
│   ├── index.html            # Dashboard (SPA)
│   ├── app.js                # Lógica del frontend + registro Service Worker
│   ├── style.css             # Estilos responsive
│   ├── manifest.json         # PWA manifest
│   ├── sw.js                 # Service Worker (caché offline)
│   └── icons/                # Íconos PWA
├── scripts/
│   └── seed.js               # Generador de datos históricos (6h)
├── package.json
├── .env.example
└── README.md
```

## API REST

| Método | Endpoint | Descripción |
|---|---|---|
| GET | `/api/stations` | Estaciones + última lectura + AQI |
| GET | `/api/stations/:id/history?hours=6` | Historial para gráficos |
| GET | `/api/predictions/:id` | Predicción temporal +1h/+2h |
| GET | `/api/heatmap` | Grilla IDW de AQI para mapa de dispersión |
| GET | `/api/alerts` | Alertas activas |
| POST | `/api/route` | Ruta saludable segmentada con AQI por tramo |

## Algoritmos

### AQI (Air Quality Index) — EPA

Se aplica la fórmula lineal por tramos de la EPA sobre PM2.5:

```
AQI = ((AQI_hi - AQI_lo) / (C_hi - C_lo)) × (C - C_lo) + AQI_lo
```

Donde C es la concentración de PM2.5 y los breakpoints definen las 6 categorías (Buena → Peligrosa).

### Regresión Lineal Simple (predicción temporal)

Para cada estación, se toman las últimas 20 lecturas (dentro de las últimas 2 horas) y se ajusta una recta `y = mx + b` donde:
- x = tiempo en minutos desde la primera lectura
- y = PM2.5

Se extrapola a +60 min y +120 min para obtener el PM2.5 futuro y su AQI correspondiente. Si la tendencia es creciente y cruza el umbral de 100 AQI, se genera una alerta.

### IDW — Inverse Distance Weighting (predicción espacial)

Para estimar el AQI en cualquier punto del mapa, se interpola usando las 5 estaciones como referencia:

```
valor(x) = Σ(wi × vi) / Σ(wi)
donde wi = 1 / d(x, xi)^p
```

Con p=2 (potencia cuadrática). Los puntos más cercanos a una estación toman su valor; los lejanos son un promedio ponderado.

## Notas Importantes

- Los datos son **simulados** y no representan mediciones oficiales
- El seed genera datos **relativos a la hora actual** (nunca fechas fijas)
- Ejecutar `npm run seed` **cada vez que se quiera reiniciar** el historial
- La simulación en tiempo real comienza automáticamente al iniciar el servidor (1 lectura cada 5s por estación)
- La PWA cachea datos para uso offline, pero requiere conexión inicial
