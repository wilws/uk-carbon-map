import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// StrictMode intentionally omitted: its dev-only double-mount conflicts with the
// imperative Three.js canvas setup in LiveMap (duplicate/zombie canvases).
createRoot(document.getElementById('root')!).render(
  <App />,
)
