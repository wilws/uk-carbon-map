import { useEffect, useRef, useState } from 'react'


export interface GenerationMixItem {
  fuel: string
  perc: number
}
export interface RegionSnapshot {
  region_id: number
  shortname: string
  from: string
  to: string
  intensity: { forecast: number; index: string }
  generationmix: GenerationMixItem[]
}
export type RegionMap = Record<number, RegionSnapshot>

const WEBSOCKET_PATH = import.meta.env.VITE_WS_URL

export function useGridSocket(url: string = WEBSOCKET_PATH) {
  const [regions, setRegions] = useState<RegionMap>({})
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let closedByUs = false

    const connect = () => {
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => setConnected(true)

      ws.onmessage = (event) => {
        try {
          const snap: RegionSnapshot = JSON.parse(event.data)
          // each message is ONE region — merge it into the map by region_id
          if (snap && typeof snap.region_id === 'number') {
            setRegions((prev) => ({ ...prev, [snap.region_id]: snap }))
          }
        } catch {
          // ignore malformed payloads
        }
      }

      ws.onerror = () => ws.close()

      ws.onclose = () => {
        setConnected(false)
        if (!closedByUs) {
          // gateway restarted / dropped — retry in 2s
          reconnectRef.current = setTimeout(connect, 2000)
        }
      }
    }

    connect()

    return () => {
      closedByUs = true
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [url])

  return { regions, connected }
}
