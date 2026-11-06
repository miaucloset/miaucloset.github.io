// Único punto de contacto con la IA.
// Prototipo: llave de cada usuaria (BYOK). Versión pública: reemplazar este archivo por llamadas a un backend propio.
import { GoogleGenAI } from '@google/genai'
import { leerAjuste, guardarAjuste } from '../db'

export const COSTO_IMAGEN_USD = 0.05

let cliente: GoogleGenAI | null = null
let llaveCliente = ''

export const obtenerLlave = () => leerAjuste<string>('llaveIa', '')

export async function guardarLlave(llave: string) {
  await guardarAjuste('llaveIa', llave.trim())
  cliente = null
}

async function ia(): Promise<GoogleGenAI> {
  const llave = await obtenerLlave()
  if (!llave) throw new Error('SIN_LLAVE')
  if (!cliente || llaveCliente !== llave) {
    cliente = new GoogleGenAI({ apiKey: llave })
    llaveCliente = llave
  }
  return cliente
}

/* ---------- Elección automática de modelos (Google cambia nombres seguido) ---------- */

function elegirModelos(nombres: string[]) {
  const n = nombres.map((x) => x.replace(/^models\//, ''))
  const texto =
    n.find((x) => x === 'gemini-flash-latest') ??
    n.filter((x) => /^gemini-[\d.]+-flash$/.test(x)).sort().reverse()[0] ??
    n.find((x) => x.includes('flash') && !/image|tts|live|audio|lite|embed/.test(x)) ??
    'gemini-flash-latest'
  const imagen =
    n.filter((x) => /flash.*image|nano-banana/.test(x) && !/preview/.test(x)).sort().reverse()[0] ??
    n.filter((x) => /image/.test(x) && x.startsWith('gemini')).sort().reverse()[0] ??
    'gemini-2.5-flash-image'
  return { texto, imagen }
}

async function detectarModelos(c: GoogleGenAI) {
  const nombres: string[] = []
  const pager = await c.models.list({ config: { pageSize: 200 } })
  for await (const m of pager) {
    if (m.name && (m.supportedActions ?? ['generateContent']).includes('generateContent')) nombres.push(m.name)
  }
  return elegirModelos(nombres)
}

export const modeloTexto = () => leerAjuste<string>('modeloTexto', 'gemini-flash-latest')
export const modeloImagen = () => leerAjuste<string>('modeloImagen', 'gemini-2.5-flash-image')

/** Verifica la llave y deja elegidos los mejores modelos disponibles. */
export async function probarLlave(llave: string): Promise<{ ok: boolean; error?: string }> {
  const limpia = llave.trim()
  // Formatos de Google: "AIza…" (antiguo) y "AQ.…" (nuevo). Aceptamos cualquier llave sin espacios.
  if (!/^[A-Za-z0-9._\-]{25,}$/.test(limpia)) return { ok: false, error: 'Eso no parece una llave. Cópiala de nuevo con el botón "Copiar clave".' }
  try {
    const c = new GoogleGenAI({ apiKey: limpia })
    const modelos = await detectarModelos(c).catch(() => null)
    if (modelos) {
      await guardarAjuste('modeloTexto', modelos.texto)
      await guardarAjuste('modeloImagen', modelos.imagen)
    }
    const r = await c.models.generateContent({ model: await modeloTexto(), contents: 'Responde solo: ok' })
    return r.text ? { ok: true } : { ok: false, error: 'La IA no respondió.' }
  } catch (e) {
    return { ok: false, error: traducirError(e) }
  }
}

export function traducirError(e: unknown): string {
  const m = String((e as Error)?.message ?? e)
  if (m.includes('SIN_LLAVE')) return 'Conecta tu IA en Ajustes.'
  if (m.includes('TOPE_DIARIO')) return 'Llegaste al tope de imágenes de hoy.'
  if (m.includes('API_KEY_INVALID') || m.includes('API key not valid')) return 'La llave no es válida. Cópiala de nuevo.'
  if (/billing|FAILED_PRECONDITION|free tier|limit: 0/i.test(m)) return 'Esta función necesita facturación activa en tu cuenta de Google.'
  if (m.includes('429') || m.includes('RESOURCE_EXHAUSTED')) return 'Límite de uso alcanzado. Espera un minuto.'
  if (m.includes('403') || m.includes('PERMISSION_DENIED')) return 'Google no dio permiso. Revisa tu llave.'
  if (/SAFETY|blocked/i.test(m)) return 'La IA no pudo procesar esta imagen. Prueba con otra foto.'
  if (m.includes('Failed to fetch') || m.includes('NetworkError') || m.includes('Load failed')) return 'Sin conexión a internet.'
  return 'Error de la IA: ' + m.slice(0, 120)
}

export const necesitaFacturacion = (e: unknown) => /billing|FAILED_PRECONDITION|free tier|limit: 0/i.test(String((e as Error)?.message ?? e))

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Cola: una solicitud a la vez, reintentos con espera creciente ante 429/503. */
let cadena: Promise<unknown> = Promise.resolve()
export function enCola<T>(tarea: () => Promise<T>, reintentos = 4): Promise<T> {
  const ejecutar = async (): Promise<T> => {
    for (let intento = 0; ; intento++) {
      try {
        return await tarea()
      } catch (e) {
        const m = String((e as Error)?.message ?? e)
        const reintentable = /429|503|500|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|INTERNAL/i.test(m) && !/limit: 0|billing/i.test(m)
        if (!reintentable || intento >= reintentos) throw e
        await espera(3000 * 2 ** intento + Math.random() * 700)
      }
    }
  }
  const p = cadena.then(ejecutar, ejecutar)
  cadena = p.catch(() => undefined)
  return p
}

type Parte = { text: string } | { inlineData: { mimeType: string; data: string } }

async function partes(texto: string, imagenes: Blob[] = []): Promise<Parte[]> {
  const p: Parte[] = []
  for (const img of imagenes) p.push({ inlineData: { mimeType: img.type || 'image/jpeg', data: await blobABase64(img) } })
  p.push({ text: texto })
  return p
}

/** Pregunta con imágenes opcionales y respuesta JSON. */
export async function preguntarJson<T>(opts: { instruccion: string; texto: string; imagenes?: Blob[] }): Promise<T> {
  return enCola(async () => {
    const c = await ia()
    const r = await c.models.generateContent({
      model: await modeloTexto(),
      contents: [{ role: 'user', parts: await partes(opts.texto, opts.imagenes) }],
      config: { systemInstruction: opts.instruccion, responseMimeType: 'application/json', temperature: 0.7 },
    })
    const t = (r.text ?? '{}').replace(/^```json\s*|```$/g, '')
    return JSON.parse(t) as T
  })
}

/* ---------- Generación de imágenes (con costo) ---------- */

const hoy = () => new Date().toISOString().slice(0, 10)

export interface UsoImagenes {
  fecha: string
  hoy: number
  mes: string
  enMes: number
}

export async function usoImagenes(): Promise<UsoImagenes> {
  const u = await leerAjuste<UsoImagenes>('usoImagenes', { fecha: hoy(), hoy: 0, mes: hoy().slice(0, 7), enMes: 0 })
  if (u.fecha !== hoy()) Object.assign(u, { fecha: hoy(), hoy: 0 })
  if (u.mes !== hoy().slice(0, 7)) Object.assign(u, { mes: hoy().slice(0, 7), enMes: 0 })
  return u
}

async function sumarUso(n: number) {
  const u = await usoImagenes()
  await guardarAjuste('usoImagenes', { ...u, hoy: u.hoy + n, enMes: u.enMes + n })
}

export async function generarImagen(texto: string, imagenes: Blob[]): Promise<Blob> {
  const u = await usoImagenes()
  const tope = await leerAjuste('topeDiarioImagenes', 4)
  if (u.hoy >= tope) throw new Error('TOPE_DIARIO')
  return enCola(async () => {
    const c = await ia()
    const r = await c.models.generateContent({
      model: await modeloImagen(),
      contents: [{ role: 'user', parts: await partes(texto, imagenes) }],
      config: { responseModalities: ['IMAGE', 'TEXT'] },
    })
    const img = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData
    if (!img?.data) throw new Error('SAFETY: sin imagen')
    await sumarUso(1)
    return base64ABlob(img.data, img.mimeType ?? 'image/png')
  }, 2)
}

/* ---------- Lotes (mitad de precio, listo en horas) ---------- */

export async function crearLoteImagenes(pedidos: { clave: string; texto: string; imagenes: Blob[] }[]): Promise<string> {
  const c = await ia()
  const modelo = await modeloImagen()
  const job = await c.batches.create({
    model: modelo,
    src: await Promise.all(
      pedidos.map(async (p) => ({
        contents: [{ role: 'user', parts: await partes(p.texto, p.imagenes) }],
        config: { responseModalities: ['IMAGE', 'TEXT'] },
        metadata: { clave: p.clave },
      })),
    ),
    config: { displayName: `miau-lookbook-${hoy()}` },
  })
  if (!job.name) throw new Error('No se pudo crear el lote')
  return job.name
}

export async function revisarLote(nombre: string): Promise<{ estado: 'listo' | 'pendiente' | 'error'; imagenes: Record<string, Blob> }> {
  const c = await ia()
  const job = await c.batches.get({ name: nombre })
  const estado = String(job.state ?? '')
  if (/FAILED|CANCELLED|EXPIRED/.test(estado)) return { estado: 'error', imagenes: {} }
  if (!/SUCCEEDED/.test(estado)) return { estado: 'pendiente', imagenes: {} }
  const imagenes: Record<string, Blob> = {}
  for (const [i, r] of (job.dest?.inlinedResponses ?? []).entries()) {
    const d = r.response?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData
    if (d?.data) imagenes[r.metadata?.clave ?? String(i)] = base64ABlob(d.data, d.mimeType ?? 'image/png')
  }
  await sumarUso(Object.keys(imagenes).length / 2) // mitad de precio
  return { estado: 'listo', imagenes }
}

/* ---------- Utilidades ---------- */

export async function blobABase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}

export function base64ABlob(b64: string, tipo: string): Blob {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: tipo })
}
