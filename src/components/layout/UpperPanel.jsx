import React from 'react'
import './UpperPanel.css'

import { useDataContext } from '../../context/DataContext'

// Reduced interval list as requested
const UPPER_PANEL_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w'];

// Mapped labels for display
const INTERVAL_LABELS = {
    '1m': '1min',
    '3m': '3min',
    '5m': '5min',
    '15m': '15min',
    '30m': '30min',
    '1h': '1h',
    '2h': '2h',
    '4h': '4h',
    '1d': '1d',
    '1w': '1w',
};

const UpperPanel = () => {
    const { panel, handlePanelUpdate } = useDataContext();

    const handleIntervalClick = (interval) => {
        if (interval !== panel.interval) {
            handlePanelUpdate({ ...panel, interval }, true);
        }
    };

    return (
        <div className="upper-panel">
            <div className="interval-buttons">
                {UPPER_PANEL_INTERVALS.map((interval) => (
                    <button
                        key={interval}
                        type="button"
                        className={`interval-button ${panel.interval === interval ? 'active' : ''}`}
                        onClick={() => handleIntervalClick(interval)}
                    >
                        {INTERVAL_LABELS[interval] || interval}
                    </button>
                ))}
            </div>
        </div>
    )
}

export default UpperPanel
