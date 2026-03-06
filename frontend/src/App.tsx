import { useEffect } from 'react';
import { usePairStore } from './stores/pairStore';
import Sidebar from './components/Sidebar';
import LeftPanel from './components/LeftPanel';
import RightPanel from './components/RightPanel';

function App() {
  const { init, pairs, selectedPairId } = usePairStore();

  useEffect(() => {
    init();
  }, [init]);

  const selectedPair = pairs.find(p => p.id === selectedPairId);

  return (
    <div className="flex h-screen bg-bg-primary text-text-primary">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        {selectedPair ? (
          <div className="flex-1 flex min-h-0">
            {/* Left Panel - Chat */}
            <div className="w-1/2 border-r border-border flex flex-col min-h-0">
              <LeftPanel pair={selectedPair} />
            </div>

            {/* Right Panel - Implementation */}
            <div className="w-1/2 flex flex-col min-h-0">
              <RightPanel pair={selectedPair} />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-text-muted">
            <div className="text-center">
              <h2 className="text-xl font-semibold mb-2">ClaudeDuo</h2>
              <p className="text-sm">Selectionne une paire ou cree-en une nouvelle</p>
              <p className="text-xs mt-4 text-text-muted">
                Chat &rarr; Push PRD &rarr; Analyse &rarr; Implementation
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
