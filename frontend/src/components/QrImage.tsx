import { useEffect, useState, useCallback } from 'react'
import QRCode from 'qrcode'
import { Download, RefreshCw } from 'lucide-react'

interface Props {
  value: string
  size?: number
  label?: string
  showDownload?: boolean
  downloadName?: string
}

export function QrImage({ value, size = 220, label, showDownload = false, downloadName = 'qr' }: Props) {
  const [src, setSrc] = useState('')
  const [generando, setGenerando] = useState(true)

  const generar = useCallback(async () => {
    if (!value) return
    setGenerando(true)
    try {
      const url = await QRCode.toDataURL(value, {
        width: size * 2,
        margin: 2,
        errorCorrectionLevel: 'H',
        color: { dark: '#0f172a', light: '#ffffff' },
      })
      setSrc(url)
    } finally {
      setGenerando(false)
    }
  }, [value, size])

  useEffect(() => { generar() }, [generar])

  function descargar() {
    if (!src) return
    const a = document.createElement('a')
    a.href = src
    a.download = `${downloadName}.png`
    a.click()
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Marco del QR */}
      <div
        className="relative rounded-2xl overflow-hidden shadow-lg border-4 border-slate-800 bg-white p-2"
        style={{ width: size + 24, height: size + 24 }}
      >
        {generando ? (
          <div
            className="flex items-center justify-center bg-slate-50 rounded-xl"
            style={{ width: size, height: size }}
          >
            <RefreshCw size={28} className="text-slate-300 animate-spin" />
          </div>
        ) : (
          <img
            src={src}
            alt="Código QR"
            className="rounded-xl"
            style={{ width: size, height: size }}
          />
        )}
      </div>

      {label && (
        <p className="text-xs text-slate-500 font-medium tracking-wide uppercase text-center">
          {label}
        </p>
      )}

      {showDownload && src && !generando && (
        <button
          onClick={descargar}
          className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          <Download size={13} />
          Descargar QR
        </button>
      )}
    </div>
  )
}
