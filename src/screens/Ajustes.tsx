import { useEffect, useState } from 'react'
import { Boton, Tarjeta, Titulo, Aviso, Pantalla, Volver } from '../components/ui'
import { avisar, DetalleTecnico } from '../components/comunes'
import { obtenerLlave, guardarLlave, probarLlave, modeloTexto, modeloImagen, usoImagenes, COSTO_IMAGEN_USD } from '../lib/gemini'
import { googleDisponible, entrarConGoogle, salirDeGoogle, guardarConfigNube, type UsuarioGoogle } from '../lib/google'
import { sincronizar, exportarRespaldo, importarRespaldo } from '../lib/sync'
import { resumenParaChatGpt } from '../lib/ia'
import { db, leerAjuste, guardarAjuste } from '../db'
import { useMoneda, MONEDAS, fijarMoneda } from '../lib/moneda'
import { TEMAS, leerTema, aplicarTema } from '../lib/tema'

export default function Ajustes({ volver }: { volver: () => void }) {
  const [llave, setLlave] = useState('')
  const [editarLlave, setEditarLlave] = useState(false)
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error' | 'info'; texto: string; detalle?: string } | null>(null)
  const [usuario, setUsuario] = useState<UsuarioGoogle | null>(null)
  const [probador, setProbador] = useState(true)
  const [tope, setTope] = useState(4)
  const [uso, setUso] = useState({ hoy: 0, enMes: 0 })
  const [sync, setSync] = useState('')
  const [ultimoSync, setUltimoSync] = useState('')
  const [modelos, setModelos] = useState(['', ''])
  const { formato, moneda } = useMoneda()
  const [tema, setTemaLocal] = useState(leerTema())

  useEffect(() => {
    ;(async () => {
      setLlave(await obtenerLlave())
      setUsuario(await leerAjuste<UsuarioGoogle | null>('googleUsuario', null))
      setProbador(await leerAjuste('probadorAutomatico', true))
      setTope(await leerAjuste('topeDiarioImagenes', 4))
      setUso(await usoImagenes())
      setUltimoSync(await leerAjuste('ultimoSync', ''))
      setModelos([await modeloTexto(), await modeloImagen()])
    })()
  }, [])

  async function probar() {
    setEstado({ tipo: 'info', texto: 'Probando…' })
    const r = await probarLlave(llave, (t) => setEstado({ tipo: 'info', texto: t }))
    if (r.ok) {
      await guardarLlave(llave)
      if (usuario) await guardarConfigNube({ llaveIa: llave.trim() }).catch(() => undefined)
      setEstado({ tipo: 'ok', texto: 'Conectada ✅' })
      setEditarLlave(false)
      setModelos([await modeloTexto(), await modeloImagen()])
    } else setEstado({ tipo: 'error', texto: r.error ?? 'No funcionó', detalle: r.detalle })
  }

  async function pegar() {
    const t = await navigator.clipboard?.readText().catch(() => '')
    if (t) setLlave(t.trim())
  }

  async function sincronizarAhora() {
    setSync('Conectando…')
    try {
      const r = await sincronizar(setSync)
      setSync(`✓ Listo · ${r.bajadas} bajadas · ${r.subidas} fotos subidas`)
      setUltimoSync(await leerAjuste('ultimoSync', ''))
    } catch {
      setSync('No se pudo sincronizar. Vuelve a entrar con Google.')
    }
  }

  async function exportar() {
    avisar('📦 Preparando respaldo…')
    const f = await exportarRespaldo()
    if (navigator.canShare?.({ files: [f] })) {
      await navigator.share({ files: [f] }).catch(() => undefined)
    } else {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(f)
      a.download = f.name
      a.click()
    }
  }

  async function importar(f?: File) {
    if (!f) return
    const n = await importarRespaldo(f)
    avisar(`✓ ${n} registros restaurados`)
  }

  async function copiarParaChatGpt() {
    const [prendas, perfil] = await Promise.all([db.prendas.toArray(), db.perfil.get('yo')])
    await navigator.clipboard.writeText(resumenParaChatGpt(prendas, perfil))
    avisar('📋 Copiado. Pégalo en ChatGPT')
    setTimeout(() => window.open('https://chatgpt.com/', '_blank'), 600)
  }

  const oculta = llave ? `${llave.slice(0, 6)}••••${llave.slice(-4)}` : ''

  return (
    <Pantalla>
      <Volver onClick={volver} />
      <Titulo>Ajustes</Titulo>

      <div className="space-y-4">
        {/* IA */}
        <Tarjeta className="space-y-3">
          <Cabecera icono="🔑" titulo="Mi IA" estado={llave ? 'Conectada' : 'Sin Conectar'} ok={Boolean(llave)} />
          {llave && !editarLlave ? (
            <div className="flex gap-2">
              <span className="flex-1 h-12 rounded-2xl bg-rosa-50 px-4 flex items-center font-mono text-sm">{oculta}</span>
              <Boton variante="secundario" className="!w-auto" onClick={() => setEditarLlave(true)}>
                Cambiar
              </Boton>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  value={llave}
                  onChange={(e) => setLlave(e.target.value)}
                  placeholder="Tu llave"
                  className="flex-1 h-12 rounded-2xl border-2 border-rosa-200 px-4 bg-rosa-50 text-sm min-w-0"
                  autoCapitalize="off"
                  autoCorrect="off"
                />
                <Boton variante="suave" className="!w-auto" onClick={pegar}>
                  📋
                </Boton>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Boton variante="secundario" icono="↗" onClick={() => window.open('https://aistudio.google.com/apikey', '_blank')}>
                  Obtener
                </Boton>
                <Boton icono="⚡" onClick={probar}>
                  Conectar
                </Boton>
              </div>
            </>
          )}
          {estado && <Aviso tipo={estado.tipo}>{estado.texto}</Aviso>}
          {estado?.detalle && <DetalleTecnico texto={estado.detalle} />}
        </Tarjeta>

        {/* Google + Sync */}
        <Tarjeta className="space-y-3">
          <Cabecera icono="☁️" titulo="Mis Dispositivos" estado={usuario ? 'Sincronizado' : 'Solo Este'} ok={Boolean(usuario)} />
          {usuario ? (
            <>
              <div className="flex items-center gap-3">
                {usuario.foto && <img src={usuario.foto} className="w-11 h-11 rounded-full" alt="" />}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{usuario.nombre}</p>
                  <p className="text-xs text-neutral-500 truncate">{usuario.email}</p>
                </div>
              </div>
              <Boton icono="🔄" onClick={sincronizarAhora}>
                Sincronizar Ahora
              </Boton>
              {sync && <Aviso>{sync}</Aviso>}
              {ultimoSync && <p className="text-xs text-neutral-400 text-center">Último: {new Date(ultimoSync).toLocaleString('es')}</p>}
              <button className="w-full text-sm text-rosa-500 font-semibold" onClick={async () => (await salirDeGoogle(), setUsuario(null))}>
                Cerrar Sesión
              </button>
            </>
          ) : googleDisponible() ? (
            <>
              <p className="text-sm text-neutral-500">Usa tu clóset en el celular y la tablet. Se guarda en tu Google Drive.</p>
              <Boton icono="G" onClick={async () => setUsuario(await entrarConGoogle())}>
                Entrar con Google
              </Boton>
            </>
          ) : (
            <Aviso>Disponible pronto. Mientras tanto usa Respaldo ↓</Aviso>
          )}
        </Tarjeta>

        {/* Probador */}
        <Tarjeta className="space-y-3">
          <Cabecera icono="🪄" titulo="Probador IA" estado={probador ? 'Activo' : 'Apagado'} ok={probador} />
          <div className="grid grid-cols-3 gap-2 text-center">
            <Mini valor={uso.hoy} texto="Hoy" />
            <Mini valor={uso.enMes} texto="Este Mes" />
            <Mini valor={formato(uso.enMes * COSTO_IMAGEN_USD)} texto="Aprox." />
          </div>
          <Fila texto="Mostrar Probador">
            <Interruptor activo={probador} alCambiar={async (v) => (setProbador(v), await guardarAjuste('probadorAutomatico', v))} />
          </Fila>
          <Fila texto="Tope Por Día">
            <div className="flex items-center gap-2">
              <button onClick={async () => { const v = Math.max(1, tope - 1); setTope(v); await guardarAjuste('topeDiarioImagenes', v) }} className="w-9 h-9 rounded-full bg-rosa-100 text-lg">−</button>
              <span className="w-6 text-center font-semibold">{tope}</span>
              <button onClick={async () => { const v = Math.min(30, tope + 1); setTope(v); await guardarAjuste('topeDiarioImagenes', v) }} className="w-9 h-9 rounded-full bg-rosa-100 text-lg">+</button>
            </div>
          </Fila>
          <p className="text-xs text-neutral-400">Cada imagen ≈ {formato(COSTO_IMAGEN_USD)} (referencial), cobrada por Google a tu cuenta. Gemini y ChatGPT siguen gratis.</p>
        </Tarjeta>

        {/* Apariencia */}
        <Tarjeta className="space-y-4">
          <Cabecera icono="🎨" titulo="Mi Estilo De App" />
          <div className="grid grid-cols-4 gap-2">
            {TEMAS.map((t) => (
              <button
                key={t.id}
                onClick={() => (aplicarTema(t.id), setTemaLocal(t.id))}
                className={`rounded-2xl p-2 flex flex-col items-center gap-1 border-2 ${tema === t.id ? 'border-tinta' : 'border-transparent'}`}
              >
                <span className="flex -space-x-2">
                  {t.colores.map((c) => (
                    <span key={c} className="w-6 h-6 rounded-full border-2 border-white" style={{ background: c }} />
                  ))}
                </span>
                <span className="text-[11px] font-bold uppercase">{t.nombre}</span>
              </button>
            ))}
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-neutral-500 mb-2">Moneda Referencial</p>
            <div className="grid grid-cols-3 gap-2">
              {MONEDAS.map((m) => (
                <button
                  key={m.codigo}
                  onClick={() => fijarMoneda(m.codigo)}
                  className={`h-14 rounded-2xl font-semibold border-2 flex flex-col items-center justify-center ${moneda === m.codigo ? 'bg-tinta text-white border-tinta' : 'bg-white border-rosa-200'}`}
                >
                  <span>
                    {m.bandera} {m.simbolo}
                  </span>
                  <span className="text-[10px] uppercase opacity-70">{m.nombre}</span>
                </button>
              ))}
            </div>
          </div>
        </Tarjeta>

        {/* Respaldo */}
        <Tarjeta className="space-y-3">
          <Cabecera icono="📦" titulo="Respaldo" />
          <div className="grid grid-cols-2 gap-2">
            <Boton variante="secundario" icono="⬇️" onClick={exportar}>
              Guardar
            </Boton>
            <label className="w-full min-h-14 rounded-2xl px-5 font-semibold flex items-center justify-center gap-2 bg-white border-2 border-tinta cursor-pointer">
              ⬆️ Restaurar
              <input type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => importar(e.target.files?.[0])} />
            </label>
          </div>
        </Tarjeta>

        {/* ChatGPT */}
        <Tarjeta className="space-y-3">
          <Cabecera icono="💬" titulo="Mi Clóset En ChatGPT" />
          <p className="text-sm text-neutral-500">Copia tu clóset y perfil para conversar con tu ChatGPT.</p>
          <Boton variante="suave" icono="📋" onClick={copiarParaChatGpt}>
            Copiar Y Abrir ChatGPT
          </Boton>
        </Tarjeta>

        {/* Avanzado */}
        <details className="bg-white rounded-3xl p-5 border border-rosa-100">
          <summary className="font-semibold uppercase tracking-wide text-sm">⚙️ Avanzado</summary>
          <div className="space-y-3 mt-4 text-sm">
            <label className="block">
              Modelo Texto
              <input
                value={modelos[0]}
                onChange={async (e) => (setModelos([e.target.value, modelos[1]]), await guardarAjuste('modeloTexto', e.target.value))}
                className="mt-1 w-full h-11 rounded-xl border-2 border-rosa-200 px-3 bg-rosa-50"
              />
            </label>
            <label className="block">
              Modelo Imagen
              <input
                value={modelos[1]}
                onChange={async (e) => (setModelos([modelos[0], e.target.value]), await guardarAjuste('modeloImagen', e.target.value))}
                className="mt-1 w-full h-11 rounded-xl border-2 border-rosa-200 px-3 bg-rosa-50"
              />
            </label>
          </div>
        </details>

        <p className="text-center text-xs text-neutral-400 pt-2">MIAU CLÓSET · v1.0 · Hecho con 🐾 para Gatofeo</p>
      </div>
    </Pantalla>
  )
}

function Cabecera({ icono, titulo, estado, ok }: { icono: string; titulo: string; estado?: string; ok?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-2xl">{icono}</span>
      <h2 className="flex-1 font-semibold uppercase tracking-wide text-sm">{titulo}</h2>
      {estado && (
        <span className={`text-[10px] font-bold uppercase rounded-full px-3 py-1 ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rosa-100 text-rosa-500'}`}>{estado}</span>
      )}
    </div>
  )
}

function Mini({ valor, texto }: { valor: number | string; texto: string }) {
  return (
    <div className="bg-rosa-50 rounded-2xl py-2">
      <p className="font-display text-xl">{valor}</p>
      <p className="text-[10px] font-bold uppercase text-neutral-500">{texto}</p>
    </div>
  )
}

function Fila({ texto, children }: { texto: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-semibold">{texto}</span>
      {children}
    </div>
  )
}

function Interruptor({ activo, alCambiar }: { activo: boolean; alCambiar: (v: boolean) => void }) {
  return (
    <button onClick={() => alCambiar(!activo)} className={`w-14 h-8 rounded-full p-1 transition ${activo ? 'bg-tinta' : 'bg-rosa-200'}`}>
      <span className={`block w-6 h-6 rounded-full bg-white shadow transition ${activo ? 'translate-x-6' : ''}`} />
    </button>
  )
}
