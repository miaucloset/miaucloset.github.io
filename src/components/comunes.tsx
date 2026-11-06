import { useEffect, useState } from 'react'
import { useMoneda } from '../lib/moneda'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, leerAjuste, guardarAjuste, ahora, type Prenda, type Capa } from '../db'
import { fotoDe, useUrl, collageParaCompartir, prepararFoto } from '../lib/imagen'
import { probarOutfit, PROMPT_PROBADOR } from '../lib/ia'
import { traducirError, necesitaFacturacion, usoImagenes, COSTO_IMAGEN_USD } from '../lib/gemini'
import { Boton, Hoja, Aviso, Cargando } from './ui'

/* ---------- Avisos flotantes ---------- */
let emitir: (t: string) => void = () => {}
export const avisar = (t: string) => emitir(t)

export function Avisos() {
  const [texto, setTexto] = useState('')
  useEffect(() => {
    let tm: ReturnType<typeof setTimeout>
    emitir = (t) => {
      setTexto(t)
      clearTimeout(tm)
      tm = setTimeout(() => setTexto(''), 2600)
    }
  }, [])
  if (!texto) return null
  return (
    <div className="fixed top-0 inset-x-0 z-50 flex justify-center safe-top pointer-events-none">
      <div className="mt-2 bg-tinta text-white text-sm font-semibold px-5 py-3 rounded-full shadow-lg animate-[fade_.2s]">{texto}</div>
    </div>
  )
}

/* ---------- Foto de prenda ---------- */
export function FotoPrenda({ prenda, className = '' }: { prenda: Prenda; className?: string }) {
  const url = useUrl(fotoDe(prenda))
  return url ? <img src={url} alt={prenda.nombre} className={`object-contain ${className}`} loading="lazy" /> : <div className={className} />
}

/* ---------- Collage de outfit (flat-lay) ---------- */
const ARRIBA: Capa[] = ['Exterior', 'Media', 'Base', 'Pieza Única']

export function Collage({ prendas, className = '' }: { prendas: Prenda[]; className?: string }) {
  const arriba = prendas.filter((p) => ARRIBA.includes(p.capa)).sort((a, b) => ARRIBA.indexOf(a.capa) - ARRIBA.indexOf(b.capa))
  const abajo = prendas.filter((p) => p.capa === 'Abajo')
  const lado = prendas.filter((p) => p.capa === 'Calzado' || p.capa === 'Accesorio')
  return (
    <div className={`bg-rosa-100/60 rounded-3xl p-3 flex gap-2 aspect-[4/5] ${className}`}>
      <div className="flex-[3] flex flex-col gap-2 min-w-0">
        {[...arriba, ...abajo].map((p) => (
          <FotoPrenda key={p.id} prenda={p} className="flex-1 min-h-0 w-full drop-shadow-md" />
        ))}
      </div>
      {lado.length > 0 && (
        <div className="flex-[2] flex flex-col gap-2 justify-end min-w-0">
          {lado.map((p) => (
            <FotoPrenda key={p.id} prenda={p} className="flex-1 max-h-[34%] min-h-0 w-full drop-shadow-md" />
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- Probador ---------- */
export function Probador({
  abierto,
  alCerrar,
  prendas,
  outfitId,
}: {
  abierto: boolean
  alCerrar: () => void
  prendas: Prenda[]
  outfitId?: string
}) {
  const perfil = useLiveQuery(() => db.perfil.get('yo'))
  const [vista, setVista] = useState<'inicio' | 'aviso' | 'cargando' | 'resultado'>('inicio')
  const [resultado, setResultado] = useState<Blob>()
  const [error, setError] = useState('')
  const [facturacion, setFacturacion] = useState(false)
  const [automatico, setAutomatico] = useState(true)
  const urlResultado = useUrl(resultado)
  const urlCuerpo = useUrl(perfil?.fotoCuerpo)
  const { formato } = useMoneda()

  useEffect(() => {
    if (!abierto) return
    setVista('inicio')
    setError('')
    setResultado(undefined)
    leerAjuste('probadorAutomatico', true).then(setAutomatico)
  }, [abierto])

  async function subirCuerpo(f?: File) {
    if (!f) return
    const foto = await prepararFoto(f)
    const p = (await db.perfil.get('yo')) ?? { id: 'yo' as const, apodo: 'Gatofeo', hemisferio: 'Norte' as const, noMeGusta: [], ocasiones: [], actualizadoEn: ahora() }
    await db.perfil.put({ ...p, fotoCuerpo: foto, actualizadoEn: ahora() })
  }

  async function intentar() {
    if (!(await leerAjuste('avisoCostoAceptado', false))) return setVista('aviso')
    generar()
  }

  async function generar() {
    await guardarAjuste('avisoCostoAceptado', true)
    if (!perfil?.fotoCuerpo) return
    setVista('cargando')
    setError('')
    try {
      const img = await probarOutfit(perfil.fotoCuerpo, prendas.map(fotoDe))
      setResultado(img)
      setVista('resultado')
      if (outfitId) await db.outfits.update(outfitId, { imagenProbador: img, actualizadoEn: ahora() })
    } catch (e) {
      setError(traducirError(e))
      setFacturacion(necesitaFacturacion(e))
      setVista('inicio')
    }
  }

  async function enviarA(app: 'gemini' | 'chatgpt') {
    const collage = await collageParaCompartir(prendas.map(fotoDe), perfil?.fotoCuerpo, 'MIAU CLÓSET')
    const archivo = new File([collage], 'miau-outfit.jpg', { type: 'image/jpeg' })
    const texto = PROMPT_PROBADOR.replace('de la primera foto', 'de la izquierda').replace('de las demás fotos', 'de la derecha')
    await navigator.clipboard?.writeText(texto).catch(() => undefined)
    if (navigator.canShare?.({ files: [archivo] })) {
      try {
        await navigator.share({ files: [archivo], text: texto })
        avisar('Elige ' + (app === 'gemini' ? 'Gemini' : 'ChatGPT') + ' y pega el texto 📋')
        return
      } catch {
        /* cancelado */
      }
    }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(archivo)
    a.download = archivo.name
    a.click()
    window.open(app === 'gemini' ? 'https://gemini.google.com/app' : 'https://chatgpt.com/', '_blank')
    avisar('Imagen descargada · Texto copiado 📋')
  }

  async function compartirResultado() {
    if (!resultado) return
    const f = new File([resultado], 'miau-look.png', { type: resultado.type })
    if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f] }).catch(() => undefined)
  }

  return (
    <Hoja abierta={abierto} alCerrar={alCerrar} titulo={vista === 'aviso' ? undefined : 'Pruébatelo'}>
      {vista === 'aviso' && (
        <div className="text-center space-y-4 py-2">
          <div className="text-6xl">💳</div>
          <h3 className="font-display text-2xl uppercase tracking-wider">Lo Paga Tu Google</h3>
          <div className="flex justify-center gap-2">
            <span className="px-4 py-2 rounded-full bg-white border border-rosa-200 font-semibold">≈ {formato(COSTO_IMAGEN_USD)} / Imagen</span>
          </div>
          <p className="text-sm text-neutral-500">Se cobra a tu cuenta de Google. MIAU no cobra nada.</p>
          <Boton onClick={generar} icono="🪄">
            Sí, Probar
          </Boton>
          <Boton variante="secundario" onClick={() => setVista('inicio')}>
            Ahora No
          </Boton>
        </div>
      )}

      {vista === 'cargando' && <Cargando texto="Vistiéndote…" />}

      {vista === 'resultado' && urlResultado && (
        <div className="space-y-3">
          <img src={urlResultado} alt="Tu look" className="w-full rounded-3xl shadow" />
          <div className="grid grid-cols-2 gap-2">
            <Boton variante="secundario" icono="↗" onClick={compartirResultado}>
              Compartir
            </Boton>
            <Boton icono="🔄" onClick={generar}>
              Otra Vez
            </Boton>
          </div>
        </div>
      )}

      {vista === 'inicio' && (
        <div className="space-y-4">
          <div className="flex gap-3 items-stretch">
            <div className="w-1/3 aspect-[3/5] rounded-2xl bg-white border border-rosa-100 overflow-hidden flex items-center justify-center">
              {urlCuerpo ? <img src={urlCuerpo} className="w-full h-full object-cover" alt="Tú" /> : <span className="text-4xl">🧍‍♀️</span>}
            </div>
            <Collage prendas={prendas} className="flex-1" />
          </div>

          {!perfil?.fotoCuerpo && (
            <label className="block">
              <span className="w-full min-h-14 rounded-2xl px-5 font-semibold flex items-center justify-center gap-2 bg-rosa-200 cursor-pointer">
                📸 Sube Tu Foto De Cuerpo Entero
              </span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => subirCuerpo(e.target.files?.[0])} />
            </label>
          )}

          {automatico && (
            <button
              disabled={!perfil?.fotoCuerpo}
              onClick={intentar}
              className="w-full rounded-3xl bg-tinta text-white p-4 flex items-center justify-between disabled:opacity-40"
            >
              <span className="flex items-center gap-3">
                <span className="text-3xl">🪄</span>
                <span className="text-left">
                  <span className="block font-semibold uppercase tracking-wide">Verme Con Esto</span>
                  <span className="block text-xs text-white/70">Aquí mismo · 10 seg</span>
                </span>
              </span>
              <span className="text-xs font-semibold bg-white/15 rounded-full px-3 py-1">≈ {formato(COSTO_IMAGEN_USD)}</span>
            </button>
          )}

          <div className="grid grid-cols-2 gap-3">
            <OpcionApp icono="✨" nombre="Gemini" etiqueta="Gratis" onClick={() => enviarA('gemini')} />
            <OpcionApp icono="💬" nombre="ChatGPT" etiqueta="Incluido" onClick={() => enviarA('chatgpt')} />
          </div>

          {error && (
            <Aviso tipo="error">
              {error}
              {facturacion && (
                <button className="block mt-2 font-semibold underline" onClick={() => window.open('https://aistudio.google.com/apikey', '_blank')}>
                  Activar Facturación ↗
                </button>
              )}
            </Aviso>
          )}
          <ContadorUso />
        </div>
      )}
    </Hoja>
  )
}

function OpcionApp({ icono, nombre, etiqueta, onClick }: { icono: string; nombre: string; etiqueta: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-3xl bg-white border-2 border-rosa-200 p-4 flex flex-col items-center gap-1 active:bg-rosa-100">
      <span className="text-3xl">{icono}</span>
      <span className="font-semibold uppercase tracking-wide text-sm">{nombre}</span>
      <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">{etiqueta}</span>
    </button>
  )
}

function ContadorUso() {
  const { formato } = useMoneda()
  const [uso, setUso] = useState<{ hoy: number; enMes: number }>()
  useEffect(() => void usoImagenes().then(setUso), [])
  if (!uso || uso.enMes === 0) return null
  return (
    <p className="text-center text-xs text-neutral-400">
      Este mes: {uso.enMes} imágenes · ≈ {formato(uso.enMes * COSTO_IMAGEN_USD)}
    </p>
  )
}

/* ---------- Selector de archivos con botón bonito ---------- */
export function BotonArchivo({
  children,
  icono,
  multiple,
  capture,
  alElegir,
  variante = 'principal',
}: {
  children: React.ReactNode
  icono?: string
  multiple?: boolean
  capture?: boolean
  alElegir: (f: File[]) => void
  variante?: 'principal' | 'suave' | 'secundario'
}) {
  const c = {
    principal: 'bg-tinta text-white',
    suave: 'bg-rosa-200 text-tinta',
    secundario: 'bg-white text-tinta border-2 border-tinta',
  }[variante]
  return (
    <label className={`w-full min-h-14 rounded-2xl px-5 font-semibold tracking-wide flex items-center justify-center gap-2 cursor-pointer ${c}`}>
      {icono && <span className="text-xl">{icono}</span>}
      {children}
      <input
        type="file"
        accept="image/*"
        multiple={multiple}
        {...(capture ? { capture: 'environment' as const } : {})}
        className="hidden"
        onChange={(e) => {
          const fs = [...(e.target.files ?? [])]
          e.target.value = ''
          if (fs.length) alElegir(fs)
        }}
      />
    </label>
  )
}

/** Busca prendas por id conservando el orden. */
export function usePrendas(ids: string[]) {
  return useLiveQuery(async () => (await db.prendas.bulkGet(ids)).filter((p): p is Prenda => Boolean(p)), [ids.join(',')], [])
}

/* ---------- Detalle técnico de un error (para copiar y enviar) ---------- */
export function DetalleTecnico({ texto }: { texto: string }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <div className="text-xs">
      <div className="flex gap-2">
        <button onClick={() => setAbierto(!abierto)} className="flex-1 h-10 rounded-xl bg-rosa-100 font-semibold">
          {abierto ? 'Ocultar Detalle' : 'Ver Detalle'}
        </button>
        <button
          onClick={async () => (await navigator.clipboard?.writeText(texto).catch(() => undefined), avisar('📋 Detalle copiado'))}
          className="flex-1 h-10 rounded-xl bg-rosa-100 font-semibold"
        >
          📋 Copiar Detalle
        </button>
      </div>
      {abierto && <pre className="mt-2 p-3 rounded-xl bg-white border border-rosa-100 whitespace-pre-wrap break-all text-neutral-600">{texto}</pre>}
    </div>
  )
}
