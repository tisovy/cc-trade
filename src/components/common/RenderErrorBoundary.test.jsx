import { useEffect } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RenderErrorBoundary from './RenderErrorBoundary.jsx'

let errorLog
beforeEach(() => { errorLog = vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => errorLog.mockRestore())

describe('scoped render recovery', () => {
  it('renders healthy children without inserting wrapper DOM', () => {
    const view = render(<RenderErrorBoundary><span>Healthy</span></RenderErrorBoundary>)
    expect(view.container.innerHTML).toBe('<span>Healthy</span>')
  })

  it('keeps siblings mounted, withholds raw error text and retries only on user action', () => {
    let failed = false
    const mounted = vi.fn(), unmounted = vi.fn()
    const Account = () => {
      useEffect(() => { mounted(); return unmounted }, [])
      return <button>Account controls</button>
    }
    const Panel = () => {
      if (failed) throw new Error('secret-like-error-payload')
      return <span>Chart data</span>
    }
    const tree = () => <><Account /><RenderErrorBoundary title="Chart"><Panel /></RenderErrorBoundary></>
    const view = render(tree())
    failed = true
    view.rerender(tree())
    expect(screen.getByText('Chart unavailable')).toBeInTheDocument()
    expect(screen.queryByText('secret-like-error-payload')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Account controls' })).toBeInTheDocument()
    expect(mounted).toHaveBeenCalledOnce()
    expect(unmounted).not.toHaveBeenCalled()
    failed = false
    view.rerender(tree())
    expect(screen.queryByText('Chart data')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry panel' }))
    expect(screen.getByText('Chart data')).toBeInTheDocument()
    expect(mounted).toHaveBeenCalledOnce()
    expect(unmounted).not.toHaveBeenCalled()
  })

  it('contains repeated failure after an explicit retry', () => {
    const Broken = () => { throw new Error('still broken') }
    render(<RenderErrorBoundary title="Analytics"><Broken /></RenderErrorBoundary>)
    fireEvent.click(screen.getByRole('button', { name: 'Retry panel' }))
    expect(screen.getByText('Analytics unavailable')).toBeInTheDocument()
  })
})
