import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { bridgeWindowFocus } from './focus'
import { loads } from './queries'
import { createQueryClient } from './queryClient'
import { applyTheme } from './theme'
import './styles.css'

applyTheme()
bridgeWindowFocus((listener) => window.jm.onWindowFocus(listener))
window.jm.onIssuesProgress((progress) => {
  loads.report(progress)
})

const queryClient = createQueryClient()
const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
