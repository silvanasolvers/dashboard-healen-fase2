# Healen OS — sistema de diseño

Dashboard del centro de medicina regenerativa Healen (fase 2). Lujo clínico,
sleek tipo Apple, glanceable. La regla rectora: **ver el estado, no leerlo**.

## Registro
Product (la UI sirve a la tarea), pero elevado a nivel insignia porque también
demuestra calidad al cliente. Mobile-first.

## Escena
"Una clínica revisa un iPad entre pacientes, en una sala minimalista y luminosa,
queriendo saber en dos segundos quién está por terminar y qué reponer." → tema
**claro**, calmado, premium.

## Color (OKLCH, ver `src/styles.css`)
Estrategia: Restrained + acentos semáforo en los momentos que importan.
- Lienzo: blanco casi puro con tinte violeta tenue (`--bg`, `--surface`).
- Marca Healen: violeta `--brand` / `--brand-strong`.
- **Semáforo** (el lenguaje central): `--ok` esmeralda · `--warn` ámbar · `--danger` rosa-rojo.
- Tinta profunda violeta para legibilidad (≥4.5:1).

## Tipografía
Una sola familia: **Inter** (variable), cifras tabulares para todo dato. Sin
fuente display — al estilo SF Pro de Apple, una familia bien afinada.

## Elemento de firma: el anillo de tratamiento (`TreatmentRing`)
Anillo SVG estilo Apple Activity. Se vacía según días restantes y cambia de color
verde→ámbar→rojo (`treatmentSignal`: ≤5 rojo, ≤12 ámbar, resto verde). El número
de días va al centro. Se rellena animado con GSAP al montar. Es el semáforo que
pidió el cliente: rojo = está por acabarse → vender; vuelve a verde al reponer.
Reutilizado en Inicio (pared de urgencia), Pacientes, Alertas y los modales.

## Movimiento
- Fondo **WebGL** (`src/aurora.ts`): aurora violeta que deriva lento, muy suave,
  consciente de `prefers-reduced-motion` (un cuadro estático).
- **GSAP**: relleno de anillos, conteo de cifras (`CountUp`).
- Entrada de vista: cascada **CSS** por sección (`.view > *:nth-child`), robusta —
  el contenido es visible por defecto, la animación solo realza (nunca queda en
  blanco si el motor se interrumpe; aprendido tras un stranding con GSAP+StrictMode).
- Gauges/barras: ancho animado vía `useGrow` + transición CSS.

## Layout
- Desktop: rail lateral fijo (vidrio) + contenido centrado, mucho aire.
- Móvil: top bar + **bottom tab bar** tipo app nativa (Hoy/Pacientes/Stock/Caja/Reportes),
  sidebar como drawer.
- Tarjetas 14–22px de radio, sombras suaves en capas (nunca borde+sombra como adorno).

## Arquitectura de archivos
- `src/data.ts` — tipos, datos demo y helpers (semáforos, formato, alertas).
- `src/aurora.ts` — fondo WebGL.
- `src/styles.css` — tokens + componentes.
- `src/App.tsx` — shell, vistas, anillos, modales (sheets).

## Pendiente
Front-only con datos demo en memoria. Siguiente: backend (Supabase) para persistir.
