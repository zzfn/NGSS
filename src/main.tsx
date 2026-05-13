import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { TooltipProvider } from './components/ui/tooltip'
import './styles/global.css'

const root = document.getElementById('root')
if (!root) throw new Error('root element missing')
createRoot(root).render(
  <BrowserRouter>
    <TooltipProvider delayDuration={100}>
      <App />
    </TooltipProvider>
  </BrowserRouter>
)
