import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import './styles/base.css'
import App from './App.jsx'

window.addEventListener('error', ({ message, error }) => {
  const errorDiv = document.createElement('div')
  errorDiv.style.color = 'red'
  errorDiv.style.padding = '20px'
  errorDiv.style.backgroundColor = 'white'
  errorDiv.style.position = 'absolute'
  errorDiv.style.top = '0'
  errorDiv.style.left = '0'
  errorDiv.style.zIndex = '9999'

  const heading = document.createElement('h3')
  heading.textContent = `Error: ${message}`
  const stack = document.createElement('pre')
  stack.textContent = error?.stack || ''
  errorDiv.append(heading, stack)
  document.body.appendChild(errorDiv)
  console.error(message, error)
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
