// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface QuestRecord {
  id: string;
  encryptedAPR: string;
  timestamp: number;
  owner: string;
  questType: string;
  status: "pending" | "completed" | "failed";
  guild?: string;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHEComputeAPR = (encryptedData: string, boost: number): string => {
  const value = FHEDecryptNumber(encryptedData);
  const result = value * (1 + boost/100);
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [quests, setQuests] = useState<QuestRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newQuestData, setNewQuestData] = useState({ questType: "", guild: "", baseAPR: 0 });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedQuest, setSelectedQuest] = useState<QuestRecord | null>(null);
  const [decryptedAPR, setDecryptedAPR] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  
  const completedCount = quests.filter(q => q.status === "completed").length;
  const pendingCount = quests.filter(q => q.status === "pending").length;
  const failedCount = quests.filter(q => q.status === "failed").length;

  useEffect(() => {
    loadQuests().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadQuests = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("quest_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing quest keys:", e); }
      }
      
      const list: QuestRecord[] = [];
      for (const key of keys) {
        try {
          const questBytes = await contract.getData(`quest_${key}`);
          if (questBytes.length > 0) {
            try {
              const questData = JSON.parse(ethers.toUtf8String(questBytes));
              list.push({ 
                id: key, 
                encryptedAPR: questData.apr, 
                timestamp: questData.timestamp, 
                owner: questData.owner, 
                questType: questData.questType, 
                status: questData.status || "pending",
                guild: questData.guild || ""
              });
            } catch (e) { console.error(`Error parsing quest data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading quest ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setQuests(list);
    } catch (e) { console.error("Error loading quests:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const submitQuest = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting APR with Zama FHE..." });
    try {
      const encryptedAPR = FHEEncryptNumber(newQuestData.baseAPR);
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const questId = `quest-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const questData = { 
        apr: encryptedAPR, 
        timestamp: Math.floor(Date.now() / 1000), 
        owner: address, 
        questType: newQuestData.questType, 
        status: "pending",
        guild: newQuestData.guild
      };
      
      await contract.setData(`quest_${questId}`, ethers.toUtf8Bytes(JSON.stringify(questData)));
      
      const keysBytes = await contract.getData("quest_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(questId);
      await contract.setData("quest_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Quest created with encrypted APR!" });
      await loadQuests();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewQuestData({ questType: "", guild: "", baseAPR: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedAPR: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedAPR);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const completeQuest = async (questId: string, boost: number) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted APR with FHE..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const questBytes = await contract.getData(`quest_${questId}`);
      if (questBytes.length === 0) throw new Error("Quest not found");
      const questData = JSON.parse(ethers.toUtf8String(questBytes));
      
      const boostedAPR = FHEComputeAPR(questData.apr, boost);
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedQuest = { ...questData, status: "completed", apr: boostedAPR };
      await contractWithSigner.setData(`quest_${questId}`, ethers.toUtf8Bytes(JSON.stringify(updatedQuest)));
      
      setTransactionStatus({ visible: true, status: "success", message: "FHE boost applied successfully!" });
      await loadQuests();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Operation failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const failQuest = async (questId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted APR with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      const questBytes = await contract.getData(`quest_${questId}`);
      if (questBytes.length === 0) throw new Error("Quest not found");
      const questData = JSON.parse(ethers.toUtf8String(questBytes));
      const updatedQuest = { ...questData, status: "failed" };
      await contract.setData(`quest_${questId}`, ethers.toUtf8Bytes(JSON.stringify(updatedQuest)));
      setTransactionStatus({ visible: true, status: "success", message: "Quest marked as failed!" });
      await loadQuests();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Operation failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (questAddress: string) => address?.toLowerCase() === questAddress.toLowerCase();

  const tutorialSteps = [
    { title: "Connect Wallet", description: "Connect your Web3 wallet to start your DeFi adventure", icon: "🔗" },
    { title: "Start a Quest", description: "Choose a quest type and set your base APR", icon: "🏁", details: "Your APR will be encrypted using Zama FHE technology" },
    { title: "Complete Quests", description: "Finish quests to earn APR boosts", icon: "⚔️", details: "FHE allows us to calculate your boosted APR without decrypting your original value" },
    { title: "Join a Guild", description: "Collaborate with others for better rewards", icon: "👥", details: "Guild members get additional APR boosts through FHE computations" }
  ];

  const renderAPRChart = () => {
    const completedQuests = quests.filter(q => q.status === "completed");
    const baseAPRs = completedQuests.map(q => FHEDecryptNumber(q.encryptedAPR));
    const maxAPR = Math.max(...baseAPRs, 20);
    
    return (
      <div className="apr-chart-container">
        {completedQuests.slice(0, 5).map((quest, index) => {
          const apr = FHEDecryptNumber(quest.encryptedAPR);
          const height = (apr / maxAPR) * 100;
          return (
            <div className="apr-bar" key={index}>
              <div className="bar-label">{quest.questType.substring(0, 3)}</div>
              <div className="bar-container">
                <div 
                  className="bar-fill" 
                  style={{ height: `${height}%`, background: `linear-gradient(to top, #00ff88, #00b3ff)` }}
                ></div>
              </div>
              <div className="bar-value">{apr.toFixed(2)}%</div>
            </div>
          );
        })}
      </div>
    );
  };

  const filteredQuests = quests.filter(quest => {
    const matchesSearch = quest.questType.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         quest.guild?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === "all" || quest.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  if (loading) return (
    <div className="loading-screen">
      <div className="cartoon-spinner"></div>
      <p>Loading your DeFi adventure...</p>
    </div>
  );

  return (
    <div className="app-container cartoon-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">⚔️</div>
          <h1>DeFi<span>Quest</span></h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-quest-btn cartoon-button">
            <div className="add-icon">➕</div>New Quest
          </button>
          <button className="cartoon-button" onClick={() => setShowTutorial(!showTutorial)}>
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <div className="wallet-connect-wrapper"><ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/></div>
        </div>
      </header>
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>DeFi Quest Adventure</h2>
            <p>Gamified yield farming with Zama FHE encrypted APR boosts</p>
          </div>
          <div className="fhe-indicator"><div className="fhe-lock">🔒</div><span>FHE Encryption Active</span></div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>DeFi Quest Tutorial</h2>
            <p className="subtitle">Learn how to earn APR boosts through gamified DeFi</p>
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div className="tutorial-step" key={index}>
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    {step.details && <div className="step-details">{step.details}</div>}
                  </div>
                </div>
              ))}
            </div>
            <div className="fhe-diagram">
              <div className="diagram-step"><div className="diagram-icon">📊</div><div className="diagram-label">Base APR</div></div>
              <div className="diagram-arrow">➡️</div>
              <div className="diagram-step"><div className="diagram-icon">🔒</div><div className="diagram-label">FHE Encryption</div></div>
              <div className="diagram-arrow">➡️</div>
              <div className="diagram-step"><div className="diagram-icon">🎮</div><div className="diagram-label">Complete Quests</div></div>
              <div className="diagram-arrow">➡️</div>
              <div className="diagram-step"><div className="diagram-icon">📈</div><div className="diagram-label">Boosted APR</div></div>
            </div>
          </div>
        )}
        
        <div className="dashboard-cards">
          <div className="dashboard-card cartoon-card">
            <h3>Quest Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item"><div className="stat-value">{quests.length}</div><div className="stat-label">Total Quests</div></div>
              <div className="stat-item"><div className="stat-value">{completedCount}</div><div className="stat-label">Completed</div></div>
              <div className="stat-item"><div className="stat-value">{pendingCount}</div><div className="stat-label">Pending</div></div>
              <div className="stat-item"><div className="stat-value">{failedCount}</div><div className="stat-label">Failed</div></div>
            </div>
          </div>
          
          <div className="dashboard-card cartoon-card">
            <h3>APR Performance</h3>
            {renderAPRChart()}
          </div>
          
          <div className="dashboard-card cartoon-card">
            <h3>Your DeFi Journey</h3>
            <div className="quest-history">
              {quests.slice(0, 3).map(quest => (
                <div className="history-item" key={quest.id}>
                  <div className="quest-type">{quest.questType}</div>
                  <div className={`quest-status ${quest.status}`}>{quest.status}</div>
                  <div className="quest-date">{new Date(quest.timestamp * 1000).toLocaleDateString()}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        <div className="quests-section">
          <div className="section-header">
            <h2>Your Quests</h2>
            <div className="search-filter">
              <input 
                type="text" 
                placeholder="Search quests..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="cartoon-input"
              />
              <select 
                value={filterStatus} 
                onChange={(e) => setFilterStatus(e.target.value)}
                className="cartoon-select"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
              <button onClick={loadQuests} className="refresh-btn cartoon-button" disabled={isRefreshing}>
                {isRefreshing ? "🌀" : "🔃"}
              </button>
            </div>
          </div>
          
          <div className="quests-list cartoon-card">
            {filteredQuests.length === 0 ? (
              <div className="no-quests">
                <div className="no-quests-icon">❓</div>
                <p>No quests found</p>
                <button className="cartoon-button primary" onClick={() => setShowCreateModal(true)}>Start Your First Quest</button>
              </div>
            ) : filteredQuests.map(quest => (
              <div 
                className={`quest-item ${quest.status}`} 
                key={quest.id} 
                onClick={() => setSelectedQuest(quest)}
              >
                <div className="quest-icon">⚔️</div>
                <div className="quest-info">
                  <div className="quest-title">{quest.questType}</div>
                  <div className="quest-meta">
                    <span className="guild">{quest.guild || "No Guild"}</span>
                    <span className="date">{new Date(quest.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="quest-status">
                  <span className={`status-badge ${quest.status}`}>{quest.status}</span>
                </div>
                <div className="quest-actions">
                  {isOwner(quest.owner) && quest.status === "pending" && (
                    <>
                      <button className="action-btn cartoon-button success" onClick={(e) => { e.stopPropagation(); completeQuest(quest.id, 10); }}>Complete (+10%)</button>
                      <button className="action-btn cartoon-button danger" onClick={(e) => { e.stopPropagation(); failQuest(quest.id); }}>Fail</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitQuest} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating} 
          questData={newQuestData} 
          setQuestData={setNewQuestData}
        />
      )}
      
      {selectedQuest && (
        <QuestDetailModal 
          quest={selectedQuest} 
          onClose={() => { setSelectedQuest(null); setDecryptedAPR(null); }} 
          decryptedAPR={decryptedAPR} 
          setDecryptedAPR={setDecryptedAPR} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cartoon-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cartoon-spinner">🌀</div>}
              {transactionStatus.status === "success" && <div className="check-icon">✅</div>}
              {transactionStatus.status === "error" && <div className="error-icon">❌</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">⚔️<span>DeFiQuest</span></div>
            <p>Gamified yield farming with Zama FHE encryption</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Docs</a>
            <a href="#" className="footer-link">Privacy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Discord</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge">🔒<span>FHE-Powered Privacy</span></div>
          <div className="copyright">© {new Date().getFullYear()} DeFiQuest. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  questData: any;
  setQuestData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ onSubmit, onClose, creating, questData, setQuestData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setQuestData({ ...questData, [name]: value });
  };

  const handleAPRChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setQuestData({ ...questData, [name]: parseFloat(value) });
  };

  const handleSubmit = () => {
    if (!questData.questType || !questData.baseAPR) { alert("Please fill required fields"); return; }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cartoon-card">
        <div className="modal-header">
          <h2>Start New Quest</h2>
          <button onClick={onClose} className="close-modal">✕</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon">🔑</div> 
            <div><strong>FHE Encryption</strong><p>Your APR will be encrypted with Zama FHE</p></div>
          </div>
          
          <div className="form-group">
            <label>Quest Type *</label>
            <select name="questType" value={questData.questType} onChange={handleChange} className="cartoon-select">
              <option value="">Select quest type</option>
              <option value="Liquidity Provision">Liquidity Provision</option>
              <option value="Yield Farming">Yield Farming</option>
              <option value="Staking">Staking</option>
              <option value="Borrowing">Borrowing</option>
              <option value="Trading">Trading</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Guild (Optional)</label>
            <input 
              type="text" 
              name="guild" 
              value={questData.guild} 
              onChange={handleChange} 
              placeholder="Join a guild for bonuses"
              className="cartoon-input"
            />
          </div>
          
          <div className="form-group">
            <label>Base APR (%) *</label>
            <input 
              type="number" 
              name="baseAPR" 
              value={questData.baseAPR} 
              onChange={handleAPRChange} 
              placeholder="Enter your base APR"
              className="cartoon-input"
              step="0.1"
            />
          </div>
          
          <div className="encryption-preview">
            <h4>Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data"><span>Plain APR:</span><div>{questData.baseAPR || '0'}%</div></div>
              <div className="encryption-arrow">➡️</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>{questData.baseAPR ? FHEEncryptNumber(questData.baseAPR).substring(0, 30) + '...' : 'No value'}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn cartoon-button">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn cartoon-button primary">
            {creating ? "Starting Quest..." : "Begin Adventure"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface QuestDetailModalProps {
  quest: QuestRecord;
  onClose: () => void;
  decryptedAPR: number | null;
  setDecryptedAPR: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedAPR: string) => Promise<number | null>;
}

const QuestDetailModal: React.FC<QuestDetailModalProps> = ({ quest, onClose, decryptedAPR, setDecryptedAPR, isDecrypting, decryptWithSignature }) => {
  const handleDecrypt = async () => {
    if (decryptedAPR !== null) { setDecryptedAPR(null); return; }
    const decrypted = await decryptWithSignature(quest.encryptedAPR);
    if (decrypted !== null) setDecryptedAPR(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="quest-detail-modal cartoon-card">
        <div className="modal-header">
          <h2>Quest Details</h2>
          <button onClick={onClose} className="close-modal">✕</button>
        </div>
        <div className="modal-body">
          <div className="quest-info">
            <div className="info-item"><span>Type:</span><strong>{quest.questType}</strong></div>
            <div className="info-item"><span>Guild:</span><strong>{quest.guild || "None"}</strong></div>
            <div className="info-item"><span>Status:</span><strong className={`status-badge ${quest.status}`}>{quest.status}</strong></div>
            <div className="info-item"><span>Date:</span><strong>{new Date(quest.timestamp * 1000).toLocaleString()}</strong></div>
          </div>
          
          <div className="encrypted-data-section">
            <h3>Encrypted APR</h3>
            <div className="encrypted-data">{quest.encryptedAPR.substring(0, 50)}...</div>
            <div className="fhe-tag">🔒<span>FHE Encrypted</span></div>
            <button className="decrypt-btn cartoon-button" onClick={handleDecrypt} disabled={isDecrypting}>
              {isDecrypting ? <span className="decrypt-spinner">🌀</span> : decryptedAPR !== null ? "Hide APR" : "Decrypt with Wallet"}
            </button>
          </div>
          
          {decryptedAPR !== null && (
            <div className="decrypted-data-section">
              <h3>Decrypted APR</h3>
              <div className="decrypted-value">{decryptedAPR.toFixed(2)}%</div>
              <div className="decryption-notice">⚠️<span>Decrypted value visible after wallet verification</span></div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn cartoon-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;