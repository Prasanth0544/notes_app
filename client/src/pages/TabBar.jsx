import { memo } from 'react';

const TabBar = memo(function TabBar({ openTabs, activeId, onSwitchTab, onCloseTab }) {
  if (openTabs.length === 0) return null;

  return (
    <div className="tab-bar">
      {openTabs.map(tab => (
        <div key={tab.id}
          className={`tab-item ${tab.id === activeId ? 'tab-active' : ''}`}
          onClick={() => onSwitchTab(tab.id)}
        >
          <span className="tab-icon">📄</span>
          <span>{tab.title || 'Untitled'}</span>
          <button
            className="tab-close"
            onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
            title="Close tab"
          >✕</button>
        </div>
      ))}
    </div>
  );
});

export default TabBar;
