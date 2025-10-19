pragma solidity ^0.8.24;
import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DeFiQuestFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    uint256 public currentBatchId;
    bool public batchOpen;

    struct UserEncryptedData {
        euint32 stakedAmount;
        euint32 rewardMultiplier;
        euint32 taskCompletionCount;
        ebool isEligibleForBoost;
    }
    mapping(uint256 => mapping(address => UserEncryptedData)) public userEncryptedData;
    mapping(uint256 => address[]) public batchParticipants;

    struct BatchTotals {
        euint32 totalStakedAmount;
        euint32 totalTaskCompletions;
        euint32 totalEligibleUsers;
    }
    mapping(uint256 => BatchTotals) public batchTotals;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event PauseToggled(bool indexed paused);
    event CooldownSet(uint256 indexed cooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event UserSubmission(address indexed user, uint256 indexed batchId);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 totalStakedAmountCleartext, uint256 totalTaskCompletionsCleartext, uint256 totalEligibleUsersCleartext);

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchNotOpen();
    error BatchAlreadyOpen();
    error InvalidBatchId();
    error ReplayAttempt();
    error StateMismatch();
    error DecryptionFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor() {
        owner = msg.sender;
        isProvider[owner] = true;
        cooldownSeconds = 60; // Default cooldown
        emit ProviderAdded(owner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PauseToggled(_paused);
    }

    function setCooldown(uint256 _cooldownSeconds) external onlyOwner {
        cooldownSeconds = _cooldownSeconds;
        emit CooldownSet(_cooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (batchOpen) revert BatchAlreadyOpen();
        currentBatchId++;
        batchOpen = true;
        // Initialize FHE for the new batch if not already done globally
        // This is a placeholder; actual FHE init might be more complex or handled by ZamaConfig
        // For this contract, we assume FHE is initialized by inheriting SepoliaConfig
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batchOpen) revert BatchNotOpen();
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitUserData(
        euint32 _stakedAmount,
        euint32 _rewardMultiplier,
        euint32 _taskCompletionCount,
        ebool _isEligibleForBoost
    ) external onlyProvider whenNotPaused {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        if (!batchOpen) revert BatchNotOpen();

        lastSubmissionTime[msg.sender] = block.timestamp;
        UserEncryptedData storage data = userEncryptedData[currentBatchId][msg.sender];
        data.stakedAmount = _stakedAmount;
        data.rewardMultiplier = _rewardMultiplier;
        data.taskCompletionCount = _taskCompletionCount;
        data.isEligibleForBoost = _isEligibleForBoost;

        // Add to batch participants if not already added
        bool alreadyInBatch = false;
        for (uint i = 0; i < batchParticipants[currentBatchId].length; i++) {
            if (batchParticipants[currentBatchId][i] == msg.sender) {
                alreadyInBatch = true;
                break;
            }
        }
        if (!alreadyInBatch) {
            batchParticipants[currentBatchId].push(msg.sender);
        }
        
        emit UserSubmission(msg.sender, currentBatchId);
    }

    function requestBatchSummaryDecryption(uint256 _batchId) external onlyOwner whenNotPaused {
        if (batchOpen && _batchId == currentBatchId) revert BatchNotOpen(); // Cannot decrypt an open batch
        if (_batchId == 0 || _batchId > currentBatchId) revert InvalidBatchId();
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }

        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        // 1. Prepare Ciphertexts
        // Order: totalStakedAmount, totalTaskCompletions, totalEligibleUsers
        euint32 memory totalStakedAmount = FHE.asEuint32(0);
        euint32 memory totalTaskCompletions = FHE.asEuint32(0);
        euint32 memory totalEligibleUsers = FHE.asEuint32(0);

        // Initialize if needed (though SepoliaConfig should handle this)
        // This is a simplified aggregation for demonstration
        // A real implementation would iterate through batchParticipants[_batchId]
        // and use FHE.add for each user's data.
        // For this example, we assume batchTotals[_batchId] is already populated
        // by some other process or this function is extended.
        // For now, we'll use dummy values if not initialized.
        if (!FHE.isInitialized(batchTotals[_batchId].totalStakedAmount)) {
             batchTotals[_batchId].totalStakedAmount = FHE.asEuint32(0);
        }
        if (!FHE.isInitialized(batchTotals[_batchId].totalTaskCompletions)) {
             batchTotals[_batchId].totalTaskCompletions = FHE.asEuint32(0);
        }
        if (!FHE.isInitialized(batchTotals[_batchId].totalEligibleUsers)) {
             batchTotals[_batchId].totalEligibleUsers = FHE.asEuint32(0);
        }
        
        totalStakedAmount = batchTotals[_batchId].totalStakedAmount;
        totalTaskCompletions = batchTotals[_batchId].totalTaskCompletions;
        totalEligibleUsers = batchTotals[_batchId].totalEligibleUsers;


        bytes32[] memory cts = new bytes32[](3);
        cts[0] = FHE.toBytes32(totalStakedAmount);
        cts[1] = FHE.toBytes32(totalTaskCompletions);
        cts[2] = FHE.toBytes32(totalEligibleUsers);

        // 2. Compute State Hash
        bytes32 stateHash = keccak256(abi.encode(cts, address(this)));

        // 3. Request Decryption
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        // 4. Store Context
        decryptionContexts[requestId] = DecryptionContext({
            batchId: _batchId,
            stateHash: stateHash,
            processed: false
        });

        emit DecryptionRequested(requestId, _batchId, stateHash);
    }

    function myCallback(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        // 5a. Replay Guard
        if (decryptionContexts[requestId].processed) {
            revert ReplayAttempt();
        }

        // 5b. State Verification
        // Rebuild cts in the exact same order as in requestBatchSummaryDecryption
        uint256 _batchId = decryptionContexts[requestId].batchId;
        euint32 memory totalStakedAmount = batchTotals[_batchId].totalStakedAmount;
        euint32 memory totalTaskCompletions = batchTotals[_batchId].totalTaskCompletions;
        euint32 memory totalEligibleUsers = batchTotals[_batchId].totalEligibleUsers;

        bytes32[] memory currentCts = new bytes32[](3);
        currentCts[0] = FHE.toBytes32(totalStakedAmount);
        currentCts[1] = FHE.toBytes32(totalTaskCompletions);
        currentCts[2] = FHE.toBytes32(totalEligibleUsers);

        bytes32 currentHash = keccak256(abi.encode(currentCts, address(this)));
        if (currentHash != decryptionContexts[requestId].stateHash) {
            revert StateMismatch();
        }
        // @dev State hash verification ensures that the ciphertexts that were originally submitted for decryption
        // have not changed before the decryption proof is processed. This prevents certain front-running or
        // manipulation attacks where an attacker might try to alter the state after a decryption request
        // but before the callback is invoked.

        // 5c. Proof Verification
        if (!FHE.checkSignatures(requestId, cleartexts, proof)) {
            revert DecryptionFailed();
        }

        // 5d. Decode & Finalize
        // Decode cleartexts in the same order they were requested
        uint256 totalStakedAmountCleartext = abi.decode(cleartexts[0:32], (uint256));
        uint256 totalTaskCompletionsCleartext = abi.decode(cleartexts[32:64], (uint256));
        uint256 totalEligibleUsersCleartext = abi.decode(cleartexts[64:96], (uint256));

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, _batchId, totalStakedAmountCleartext, totalTaskCompletionsCleartext, totalEligibleUsersCleartext);
        // Further logic to use these cleartext values can be added here
    }

    // Internal helper functions
    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 storage val) internal {
        if (!FHE.isInitialized(val)) {
            val = FHE.asEuint32(0);
        }
    }

    function _requireInitialized(euint32 storage val) internal view {
        if (!FHE.isInitialized(val)) {
            revert("FHE value not initialized");
        }
    }
}