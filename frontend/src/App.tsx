// @ts-ignore — plain-JSX component, no type declarations yet
import LiveMap from './components/LiveMap.jsx'
import { useGridSocket } from './hooks/useGridSocket'


function App() {
  const { regions, connected } = useGridSocket()
  return <LiveMap regions={regions} connected={connected} />
}

export default App
