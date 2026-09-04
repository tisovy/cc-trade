import { Component } from 'react'
import './RenderErrorBoundary.css'

// Recovery remounts presentation only. Callers keep account/command owners
// above this boundary; an outer owner failure supplies a reload-only fallback.
export default class RenderErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  retry = () => this.setState({ failed: false })

  render() {
    if (!this.state.failed) return this.props.children
    if (this.props.fallback) return this.props.fallback(this.retry)
    return (
      <section className="render-failure" role="alert">
        <h2>{this.props.title ?? 'Panel'} unavailable</h2>
        <p>This panel could not be displayed. Other account controls remain separate.</p>
        <button type="button" onClick={this.retry}>Retry panel</button>
      </section>
    )
  }
}
