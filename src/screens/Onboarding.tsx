import { useEffect, useState } from 'react'
import { Boton, Tarjeta, Aviso, Pantalla } from '../components/ui'
import { entrarConGoogle, googleDisponible, leerConfigNube, guardarConfigNube, type UsuarioGoogle } from '../lib/google'
import { guardarLlave, probarLlave } from '../lib/gemini'
import { guardarAjuste } from '../db'
import { actualizarPerfil } from './Perfil'
import { buscarCiudades, type Ciudad } from '../lib/clima'

const URL_LLAVE = 'https://aistudio.google.com/apikey'

type Paso = 'bienvenida' | 'llave' | 'ciudad' | 'listo'

export default function Onboarding({ alTerminar }: { alTerminar: () => void }) {
  const [paso, setPaso] = useState<Paso>('bienvenida')
  const [usuario, setUsuario] = useState<UsuarioGoogle | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const [volvio, setVolvio] = useState(false)
  const [manual, setManual] = useState('')
  const [verManual, setVerManual] = useState(false)

  // Detecta que regresó de AI Studio para resaltar el botón Pegar
  useEffect(() => {
    if (paso !== 'llave') return
    const alVolver = () => document.visibilityState === 'visible' && setVolvio(true)
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [paso])

  async function entrar() {
    setOcupado(true)
    setError('')
    try {
      const u = await entrarConGoogle()
      setUsuario(u)
      // ¿Ya tiene llave guardada en su Drive (ej. desde el iPhone)? → la usa directo
      const nube = await leerConfigNube().catch(() => null)
      if (nube?.llaveIa && (await probarLlave(nube.llaveIa)).ok) {
        await guardarLlave(nube.llaveIa)
        setPaso('ciudad')
      } else {
        setPaso('llave')
      }
    } catch (e) {
      const m = String((e as Error).message)
      setError(m.includes('popup') ? 'Se cerró la ventana de Google. Intenta de nuevo.' : 'No se pudo entrar con Google.')
    } finally {
      setOcupado(false)
    }
  }

  async function conectar(llave: string) {
    setOcupado(true)
    setError('')
    const r = await probarLlave(llave)
    if (!r.ok) {
      setError(r.error ?? 'No funcionó.')
      setOcupado(false)
      return
    }
    await guardarLlave(llave)
    if (usuario) await guardarConfigNube({ llaveIa: llave.trim() }).catch(() => undefined)
    setOcupado(false)
    setPaso('ciudad')
  }

  async function pegar() {
    try {
      const texto = await navigator.clipboard.readText()
      if (texto) return conectar(texto)
      setVerManual(true)
    } catch {
      setVerManual(true)
    }
  }

  async function terminar() {
    await actualizarPerfil({ nombre: usuario?.nombre })
    await guardarAjuste('onboardingListo', true)
    alTerminar()
  }

  return (
    <Pantalla>
      <div className="flex flex-col items-center text-center pt-10 pb-6">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="w-24 h-24 rounded-3xl shadow" />
        <h1 className="font-display text-4xl uppercase tracking-widest mt-5">Miau Clóset</h1>
        <p className="text-neutral-500 mt-1">Tu Clóset. Tu Estilo. Tu IA.</p>
      </div>

      <Progreso paso={paso} />

      {paso === 'bienvenida' && (
        <Tarjeta className="space-y-4">
          <h2 className="text-xl font-semibold">Hola, Gatofeo 🐾</h2>
          <p className="text-neutral-600">Tu clóset digital con estilista IA. Listo en 2 minutos.</p>
          {googleDisponible() ? (
            <>
              <Boton onClick={entrar} disabled={ocupado} icono="G">
                {ocupado ? 'Entrando…' : 'Entrar con Google'}
              </Boton>
              <button onClick={() => setPaso('llave')} className="w-full text-sm text-neutral-500 font-semibold py-2">
                Usar Solo En Este Celular
              </button>
            </>
          ) : (
            <Boton onClick={() => setPaso('llave')} icono="🐾">
              Empezar
            </Boton>
          )}
        </Tarjeta>
      )}

      {paso === 'llave' && (
        <Tarjeta className="space-y-4">
          <h2 className="text-xl font-semibold">Conecta Tu IA 🔑</h2>
          <ol className="space-y-3 text-left">
            <PasoLlave n={1} texto='Toca "Obtener Mi Llave". Se abre Google AI Studio.' />
            <PasoLlave n={2} texto='Toca "Create API key" y luego el botón Copiar.' />
            <PasoLlave n={3} texto='Vuelve aquí y toca "Pegar Mi Llave".' />
          </ol>
          <Boton variante={volvio ? 'secundario' : 'principal'} icono="↗" onClick={() => window.open(URL_LLAVE, '_blank')}>
            Obtener Mi Llave
          </Boton>
          <Boton variante={volvio ? 'principal' : 'suave'} icono="📋" onClick={pegar} disabled={ocupado}>
            {ocupado ? 'Verificando…' : 'Pegar Mi Llave'}
          </Boton>
          {verManual && (
            <div className="space-y-2">
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Pega aquí tu llave"
                className="w-full rounded-2xl border-2 border-rosa-200 px-4 py-3 bg-rosa-50"
                autoCapitalize="off"
                autoCorrect="off"
              />
              <Boton variante="secundario" onClick={() => conectar(manual)} disabled={!manual || ocupado}>
                Conectar
              </Boton>
            </div>
          )}
          {error && <Aviso tipo="error">{error}</Aviso>}
          <p className="text-xs text-neutral-400">
            Tu llave se guarda solo en este dispositivo{usuario ? ' y en una carpeta oculta de tu Google Drive' : ''}. Nadie más la ve.
          </p>
        </Tarjeta>
      )}

      {paso === 'ciudad' && <PasoCiudad alTerminar={() => setPaso('listo')} />}

      {paso === 'listo' && (
        <Tarjeta className="space-y-4 text-center">
          <div className="text-5xl">✅</div>
          <h2 className="text-xl font-semibold">¡Todo Listo, Gatofeo!</h2>
          <p className="text-neutral-600">Tu IA está conectada. Ahora vamos a llenar tu clóset.</p>
          <Boton onClick={terminar} icono="🐾">
            Empezar
          </Boton>
        </Tarjeta>
      )}
    </Pantalla>
  )
}

function Progreso({ paso }: { paso: Paso }) {
  const i = ['bienvenida', 'llave', 'ciudad', 'listo'].indexOf(paso)
  return (
    <div className="flex gap-2 justify-center mb-5">
      {[0, 1, 2, 3].map((n) => (
        <span key={n} className={`h-2 rounded-full transition-all ${n <= i ? 'w-10 bg-tinta' : 'w-5 bg-rosa-200'}`} />
      ))}
    </div>
  )
}

function PasoLlave({ n, texto }: { n: number; texto: string }) {
  return (
    <li className="flex gap-3 items-start">
      <span className="shrink-0 w-7 h-7 rounded-full bg-rosa-200 font-bold flex items-center justify-center text-sm">{n}</span>
      <span className="text-neutral-700 pt-0.5">{texto}</span>
    </li>
  )
}

function PasoCiudad({ alTerminar }: { alTerminar: () => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Ciudad[]>([])
  useEffect(() => {
    const t = setTimeout(() => buscarCiudades(q).then(setRes).catch(() => setRes([])), 350)
    return () => clearTimeout(t)
  }, [q])
  return (
    <Tarjeta className="space-y-4">
      <h2 className="text-xl font-semibold">¿Dónde Vives? 📍</h2>
      <p className="text-neutral-600 text-sm">Para el clima y tus temporadas.</p>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Tu ciudad…"
        className="w-full h-14 rounded-2xl border-2 border-rosa-200 px-4 bg-rosa-50 text-lg"
      />
      {res.map((c) => (
        <button
          key={`${c.lat}${c.lon}`}
          onClick={async () => {
            await actualizarPerfil({ ciudad: `${c.nombre}, ${c.pais}`, lat: c.lat, lon: c.lon, hemisferio: c.lat < 0 ? 'Sur' : 'Norte' })
            alTerminar()
          }}
          className="w-full text-left px-4 py-3 rounded-2xl bg-rosa-50 font-semibold"
        >
          {c.nombre} <span className="text-neutral-400 font-normal">· {c.pais}</span>
        </button>
      ))}
      <button onClick={alTerminar} className="w-full text-sm text-neutral-500 font-semibold py-2">
        Después
      </button>
    </Tarjeta>
  )
}
