document.addEventListener('DOMContentLoaded', () => {
    // Canvas and context setup
    const gameCanvas = document.getElementById('game-canvas');
    const ctx = gameCanvas.getContext('2d');
    gameCanvas.width = 800;
    gameCanvas.height = 600;

    // Map dimensions (can be larger than canvas for scrolling later)
    const MAP_WIDTH = 800; // For now, same as canvas
    const MAP_HEIGHT = 600; // For now, same as canvas

    // UI Elements
    const minimapCanvas = document.getElementById('minimap-canvas');
    const minimapCtx = minimapCanvas.getContext('2d');
    // Set minimap canvas dimensions (can also be done in HTML or CSS)
    minimapCanvas.width = 150; // As per style.css
    minimapCanvas.height = 100; // As per style.css

    const MINIMAP_SCALE_X = minimapCanvas.width / MAP_WIDTH;
    const MINIMAP_SCALE_Y = minimapCanvas.height / MAP_HEIGHT;

    const mineralsDisplay = document.getElementById('minerals');
    const gasDisplay = document.getElementById('gas');
    const statusMessageDisplay = document.getElementById('status-message');
    let gameState = 'normal'; // For handling specific input states like awaiting_gather_target
    let buildingToPlace = null;
    let currentMousePosition = { x: 0, y: 0 };
    const selectedEntityDisplay = document.getElementById('selected-entity');
    const entityHPDisplay = document.getElementById('entity-hp');
    const commandPanel = document.getElementById('command-panel');
    const unitQueueList = document.getElementById('unit-queue-list');
    const currentSupplyDisplay = document.getElementById('current-supply');
    const maxSupplyDisplay = document.getElementById('max-supply');

    // Game state variables
    let playerResources = {
        minerals: 50,
        gas: 0,
        currentSupply: 0,
        maxSupply: 0 // Will be updated by buildings
    };
    let gameObjects = []; // To store all units, buildings, resources
    let selectedObject = null;

    class Building {
        constructor(x, y, emoji, type, hp, size = 50, isAI = false) {
            this.x = x;
            this.y = y;
            this.isAI = isAI; // Added isAI property
            this.emoji = emoji;
            this.type = type;
            this.hp = hp;
            this.maxHp = hp;
            this.size = size; // For rendering and click detection
            this.isBuilding = true; // For type checking
            this.isUnit = false;
            this.productionQueue = [];
            this.resourceGenerationRate = 0; // Default, specific buildings will override
            this.lastResourceTick = 0; // For timed resource generation
            this.unitBuildTimes = {}; // Initialize, will be populated by specific building types
            this.currentProduction = null; // { type, startTime }

            this.isPlaced = false;
            this.isConstructing = false;
            this.buildProgress = 0;
            this.totalBuildTime = 5000; // Default, can be overridden by specific building types
            this.supplyProvided = 0; // New property
        }

        render(ctx) {
            if (this.isConstructing) {
                // Draw placeholder or partially built emoji/structure
                ctx.globalAlpha = 0.5 + (this.buildProgress / this.totalBuildTime) * 0.5; // Fade in
                ctx.font = `${this.size}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(this.emoji, this.x, this.y);
                ctx.globalAlpha = 1.0;

                // Draw progress bar for construction
                const progressBarWidth = this.size;
                const progressBarHeight = 5;
                const yOffset = this.y - this.size / 2 - progressBarHeight - 2;
                ctx.fillStyle = 'gray';
                ctx.fillRect(this.x - progressBarWidth / 2, yOffset, progressBarWidth, progressBarHeight);
                ctx.fillStyle = 'yellow';
                ctx.fillRect(this.x - progressBarWidth / 2, yOffset, progressBarWidth * (this.buildProgress / this.totalBuildTime), progressBarHeight);

            } else if (this.isPlaced) {
                // Existing rendering logic for a fully built building
                ctx.font = `${this.size}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(this.emoji, this.x, this.y);
                // HP bar display
                if (this.hp < this.maxHp) {
                    const hpBarWidth = this.size;
                    const hpBarHeight = 5;
                    const yOffset = this.y + this.size / 2 + hpBarHeight;
                    ctx.fillStyle = 'red';
                    ctx.fillRect(this.x - hpBarWidth / 2, yOffset, hpBarWidth, hpBarHeight);
                    ctx.fillStyle = 'green';
                    ctx.fillRect(this.x - hpBarWidth / 2, yOffset, hpBarWidth * (this.hp / this.maxHp), hpBarHeight);
                }
            } else {
                // Ghost image during placement (will be handled by main render loop for buildingToPlace)
                ctx.globalAlpha = 0.5;
                ctx.font = `${this.size}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(this.emoji, this.x, this.y);
                ctx.globalAlpha = 1.0;
            }
        }

        update(deltaTime) {
            if (this.isConstructing) {
                this.buildProgress += deltaTime * 1000; // deltaTime is in seconds
                this.hp = Math.max(1, (this.buildProgress / this.totalBuildTime) * this.maxHp); // HP tied to progress
                if (this.buildProgress >= this.totalBuildTime) {
                    this.isConstructing = false;
                    this.isPlaced = true; // Fully operational
                    this.hp = this.maxHp; // Restore to full HP after construction
                    this.buildProgress = this.totalBuildTime; // Cap progress
                    console.log(`${this.type} at (${this.x}, ${this.y}) construction complete.`);
                    // If this building provides supply, update the max supply
                    if (this.supplyProvided > 0) { 
                        updateMaxSupply();
                    }
                }
            }

            if (!this.isConstructing && this.isPlaced) {
                // Passive resource generation for specific buildings
                if (this.type === 'CommandCenter' && this.resourceGenerationRate > 0) {
                    this.lastResourceTick += deltaTime; // deltaTime is in seconds
                    if (this.lastResourceTick >= 1) { // Every 1 second
                        const ticks = Math.floor(this.lastResourceTick);
                        if (this.isAI) {
                            aiPlayerResources.minerals += this.resourceGenerationRate * ticks;
                        } else {
                            playerResources.minerals += this.resourceGenerationRate * ticks;
                        }
                        // console.log(`${this.isAI ? "AI" : "Player"} CommandCenter generated ${this.resourceGenerationRate * ticks} minerals.`);
                        this.lastResourceTick -= ticks; // Correctly subtract processed ticks
                    }
                }
                // Process production queue
                if (!this.currentProduction && this.productionQueue.length > 0) {
                    this.currentProduction = {
                        type: this.productionQueue.shift(),
                        startTime: Date.now()
                    };
                    console.log(`Started building ${this.currentProduction.type}`);
                }

                if (this.currentProduction) {
                    const buildTime = this.unitBuildTimes[this.currentProduction.type];
                    if (buildTime && Date.now() - this.currentProduction.startTime >= buildTime) {
                        const spawnX = this.x + this.size / 2 + 20;
                        const spawnY = this.y;
                        let newUnit;
                        const unitType = this.currentProduction.type;

                        // Player's units are created with isAI = false
                        if (unitType === 'Collector') {
                            newUnit = new Collector(spawnX, spawnY, false);
                        } else if (unitType === 'Soldier') {
                            newUnit = new Soldier(spawnX, spawnY, false);
                        } else if (unitType === 'SuperSoldier') {
                            newUnit = new SuperSoldier(spawnX, spawnY, false);
                        } else if (unitType === 'Tank') {
                            newUnit = new Tank(spawnX, spawnY, false);
                        }

                        if (newUnit) {
                            gameObjects.push(newUnit);
                            if (newUnit.supplyCost > 0) { // Check if the unit actually costs supply
                                playerResources.currentSupply += newUnit.supplyCost;
                            }
                            console.log(`${unitType} built! Current supply: ${playerResources.currentSupply}/${playerResources.maxSupply}`);
                            // updateBuildQueueDisplay(); // Already called by main loop or selection change
                        }
                        this.currentProduction = null;
                    } else if (!buildTime) {
                        // This case should ideally not be reached if buttons only allow valid units
                        console.error(`Build time for ${this.currentProduction.type} is undefined for ${this.type}!`);
                        this.currentProduction = null; // Clear invalid production
                    }
                }
            }
        }
    }

    function updateBuildQueueDisplay() {
        unitQueueList.innerHTML = ''; // Clear current list

        if (selectedObject && selectedObject.isBuilding && selectedObject.productionQueue) {
            // Display item currently in production
            if (selectedObject.currentProduction) {
                const currentItem = document.createElement('li');
                let progress = 0;
                if (selectedObject.unitBuildTimes && selectedObject.unitBuildTimes[selectedObject.currentProduction.type]) {
                    const buildTime = selectedObject.unitBuildTimes[selectedObject.currentProduction.type];
                    const elapsedTime = Date.now() - selectedObject.currentProduction.startTime;
                    progress = Math.min(100, Math.floor((elapsedTime / buildTime) * 100));
                }
                currentItem.textContent = `Producing: ${selectedObject.currentProduction.type} (${progress}%)`;
                unitQueueList.appendChild(currentItem);
            }

            // Display queued items
            selectedObject.productionQueue.forEach(unitType => {
                const listItem = document.createElement('li');
                listItem.textContent = `Queue: ${unitType}`;
                unitQueueList.appendChild(listItem);
            });
        }
    }

    class Unit {
        constructor(x, y, emoji, type, hp, speed, size = 20, isAI = false) {
            this.x = x;
            this.y = y;
            this.isAI = isAI; // Added isAI property
            this.emoji = emoji;
            this.type = type;
            this.hp = hp;
            this.maxHp = hp;
            this.speed = speed; // Pixels per second
            this.size = size;
            this.isUnit = true;
            this.isBuilding = false;
            this.target = null; // {x, y} for movement
            this.action = 'idle'; // e.g., 'moving', 'gathering', 'returning'
            this.selected = false; // For visual feedback or group selection later
            this.supplyCost = 1; // New property, can be overridden by specific units
        }

        render(ctx) {
            ctx.font = `${this.size}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(this.emoji, this.x, this.y);

            // Display HP bar (similar to Building)
            if (this.hp < this.maxHp && this.selected) { // Only show HP if selected for units to reduce clutter
                const hpBarWidth = this.size * 1.5;
                const hpBarHeight = 4;
                const yOffset = this.y + this.size / 2 + hpBarHeight;
                ctx.fillStyle = 'red';
                ctx.fillRect(this.x - hpBarWidth / 2, yOffset, hpBarWidth, hpBarHeight);
                ctx.fillStyle = 'green';
                ctx.fillRect(this.x - hpBarWidth / 2, yOffset, hpBarWidth * (this.hp / this.maxHp), hpBarHeight);
            }
        }

        moveTo(targetX, targetY) {
            this.target = { x: targetX, y: targetY };
            this.action = 'moving';
            console.log(`${this.type} moving to (${targetX}, ${targetY})`);
        }

        update(deltaTime) { // deltaTime is in seconds
            if (this.action === 'moving' && this.target) {
                const dx = this.target.x - this.x;
                const dy = this.target.y - this.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < this.speed * deltaTime) {
                    this.x = this.target.x;
                    this.y = this.target.y;
                    this.target = null;
                    this.action = 'idle'; // Arrived
                    console.log(`${this.type} arrived at destination.`);
                } else {
                    this.x += (dx / distance) * this.speed * deltaTime;
                    this.y += (dy / distance) * this.speed * deltaTime;
                }
            }
            // Other actions like gathering will be handled in derived classes
        }

        stop() {
            this.action = 'idle';
            this.target = null;
            this.attackTarget = null;
            // For collectors, might need to interrupt specific gathering sub-actions
            if (this.type === 'Collector') {
                this.targetResourceNode = null; 
                // currentLoad remains, they just stop what they were doing
            }
            console.log(`${this.type} (${this.emoji}) received STOP command.`);
        }
    }

    class Collector extends Unit {
        constructor(x, y, isAI = false) { // Added isAI parameter
            super(x, y, '👷', 'Collector', 50, 60, 22, isAI); // Pass isAI to super
            this.resourceType = null; // 'minerals' or 'gas'
            this.carryCapacity = 10;
            this.currentLoad = 0;
            this.targetResourceNode = null;
            this.homeBuilding = null; // To return resources
            this.supplyCost = 1; // Explicitly set supply cost
        }

        findClosestBuilding(buildingType) {
            let closest = null;
            let minDist = Infinity;
            for (const obj of gameObjects) {
                if (obj.isBuilding && obj.type === buildingType) {
                    const dx = obj.x - this.x;
                    const dy = obj.y - this.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < minDist) {
                        minDist = dist;
                        closest = obj;
                    }
                }
            }
            return closest;
        }

        gatherFrom(resourceNode) {
            if (resourceNode && resourceNode.amount > 0) {
                this.targetResourceNode = resourceNode;
                this.resourceType = resourceNode.resourceType;
                this.moveTo(resourceNode.x, resourceNode.y);
                this.action = 'gathering_moving_to_node';
                console.log(`${this.type} moving to gather from ${resourceNode.type}`);
            }
        }

        update(deltaTime) {
            super.update(deltaTime); // Handle basic movement

            if (this.action === 'gathering_moving_to_node' && !this.target) { // Arrived at node
                this.action = 'gathering_at_node';
                // Simple instant gather for now
                if (this.targetResourceNode && this.targetResourceNode.amount > 0) {
                    const gatheredAmount = this.targetResourceNode.gather(this.carryCapacity - this.currentLoad);
                    this.currentLoad += gatheredAmount;
                    console.log(`${this.type} gathered ${gatheredAmount} ${this.resourceType}. Current load: ${this.currentLoad}`);

                    if (this.currentLoad >= this.carryCapacity || this.targetResourceNode.amount <= 0) {
                        this.homeBuilding = this.findClosestBuilding('CommandCenter');
                        if (this.homeBuilding) {
                            this.moveTo(this.homeBuilding.x, this.homeBuilding.y);
                            this.action = 'returning_resources';
                        } else {
                            this.action = 'idle'; // No drop-off point
                        }
                    } else {
                        // Continue gathering if node still has resources and collector has capacity
                        // For simplicity, we'll make it move back and forth for now.
                        // A more advanced logic would make it stay and gather for a few ticks.
                         this.action = 'gathering_at_node'; // Stay to gather more next tick, or move if full
                    }
                } else {
                    this.action = 'idle'; // Node depleted or invalid
                }
            } else if (this.action === 'returning_resources' && !this.target) { // Arrived at home building
                if (this.resourceType === 'minerals') {
                    playerResources.minerals += this.currentLoad;
                } else if (this.resourceType === 'gas') {
                    playerResources.gas += this.currentLoad;
                }
                console.log(`${this.type} deposited ${this.currentLoad} ${this.resourceType}.`);
                this.currentLoad = 0;
                // Go back to gathering from the same node if it's still valid
                if (this.targetResourceNode && this.targetResourceNode.amount > 0) {
                    this.gatherFrom(this.targetResourceNode);
                } else {
                    this.action = 'idle';
                    this.targetResourceNode = null;
                }
            }
        }
    }

    // After the Collector class definition

    class Soldier extends Unit {
        constructor(x, y, isAI = false) { // Added isAI parameter
            super(x, y, '💂', 'Soldier', 100, 50, 24, isAI); // Pass isAI to super
            this.attackDamage = 10;
            this.attackRange = 80; // pixels
            this.attackSpeed = 1000; // ms per attack (1 attack per second)
            this.lastAttackTime = 0;
            this.attackTarget = null;
            this.supplyCost = 1; // Explicitly set supply cost
        }

        canAttack(target) {
            if (!target || target.hp <= 0 || target === this) return false;
            const dx = target.x - this.x;
            const dy = target.y - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            return distance <= this.attackRange;
        }

        attack(target) {
            if (target && target.hp > 0) {
                console.log(`${this.type} attacking ${target.type} (${target.emoji})`);
                target.hp -= this.attackDamage;
                if (target.hp <= 0) {
                    console.log(`${target.type} (${target.emoji}) destroyed!`);
                    target.isDestroyed = true; // Mark for removal
                    this.attackTarget = null;
                    this.action = 'idle';
                }
            }
        }

        update(deltaTime) {
            super.update(deltaTime); // Handle basic movement

            if (this.action === 'moving_to_attack' && this.attackTarget) {
                if (this.canAttack(this.attackTarget)) {
                    this.action = 'attacking';
                    this.target = null; // Stop moving
                } else if (this.attackTarget.hp <=0) { // Target died while moving
                    this.attackTarget = null;
                    this.action = 'idle';
                } else { // Keep moving towards target
                    this.moveTo(this.attackTarget.x, this.attackTarget.y);
                }
            }

            if (this.action === 'attacking' && this.attackTarget) {
                if (!this.canAttack(this.attackTarget) || this.attackTarget.hp <= 0) {
                    this.attackTarget = null;
                    this.action = 'idle';
                    return;
                }
                if (Date.now() - this.lastAttackTime >= this.attackSpeed) {
                    this.attack(this.attackTarget);
                    this.lastAttackTime = Date.now();
                }
            }
        }
    }

    class SuperSoldier extends Unit {
        constructor(x, y, isAI = false) { // Added isAI parameter
            super(x, y, '🦸', 'SuperSoldier', 150, 55, 28, isAI); // Pass isAI to super
            this.attackDamage = 20;
            this.attackRange = 100;
            this.attackSpeed = 1200;
            this.lastAttackTime = 0;
            this.attackTarget = null;
            this.supplyCost = 2; // Explicitly set supply cost
        }
        // Identical canAttack, attack, and update methods as Soldier for now.
        // Could be refactored into Unit class or a CombatUnit subclass later.
        // canAttack(target) { /* ... copy from Soldier ... */ }
        // attack(target) { /* ... copy from Soldier ... */ }
        // update(deltaTime) { /* ... copy from Soldier, ensure super.update(deltaTime) is called ... */ }
    }
    // Ensure to copy the methods for SuperSoldier and Tank properly
    // For SuperSoldier:
    SuperSoldier.prototype.canAttack = Soldier.prototype.canAttack;
    SuperSoldier.prototype.attack = Soldier.prototype.attack;
    SuperSoldier.prototype.update = Soldier.prototype.update;


    class Tank extends Unit {
        constructor(x, y, isAI = false) { // Added isAI parameter
            super(x, y, '🚜', 'Tank', 250, 35, 32, isAI); // Pass isAI to super
            this.attackDamage = 35;
            this.attackRange = 150;
            this.attackSpeed = 2000;
            this.lastAttackTime = 0;
            this.attackTarget = null;
            this.supplyCost = 3; // Explicitly set supply cost
        }
        // Identical canAttack, attack, and update methods as Soldier for now.
        // canAttack(target) { /* ... copy from Soldier ... */ }
        // attack(target) { /* ... copy from Soldier ... */ }
        // update(deltaTime) { /* ... copy from Soldier, ensure super.update(deltaTime) is called ... */ }
    }
    // For Tank:
    Tank.prototype.canAttack = Soldier.prototype.canAttack;
    Tank.prototype.attack = Soldier.prototype.attack;
    Tank.prototype.update = Soldier.prototype.update;

    function updateMaxSupply() {
        let newMaxSupply = 0;
        for (const obj of gameObjects) {
            if (obj.isBuilding && obj.isPlaced && !obj.isConstructing && obj.supplyProvided > 0) {
                newMaxSupply += obj.supplyProvided;
            }
        }
        playerResources.maxSupply = newMaxSupply;
        // console.log("Max supply updated to: " + playerResources.maxSupply); // For debugging
    }

    function setGameStatusMessage(message, duration = 0) {
        if (!statusMessageDisplay) return; // Guard if element not found
        statusMessageDisplay.textContent = message;
        if (duration > 0) {
            setTimeout(() => {
                if (statusMessageDisplay.textContent === message) {
                    statusMessageDisplay.textContent = ''; 
                }
            }, duration);
        }
    }

    class ResourceNode {
        constructor(x, y, emoji, resourceType, amount, size = 30) {
            this.x = x;
            this.y = y;
            this.emoji = emoji;
            this.resourceType = resourceType;
            this.amount = amount;
            this.maxAmount = amount; // To show depletion visually if desired
            this.size = size; // For rendering and click detection
            this.type = 'ResourceNode'; // For selection info
            this.hp = Infinity; // Resources don't typically have HP
            this.maxHp = Infinity;
        }

        render(ctx) {
            ctx.font = `${this.size}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(this.emoji, this.x, this.y);
            
            // Optional: Display amount remaining
            ctx.fillStyle = 'white';
            ctx.font = '10px Arial';
            ctx.fillText(this.amount, this.x, this.y + this.size / 1.5);
        }

        gather(amount) {
            const gathered = Math.min(this.amount, amount);
            this.amount -= gathered;
            if (this.amount <= 0) {
                // Optional: remove node or mark as depleted
                console.log(`${this.resourceType} node at (${this.x}, ${this.y}) depleted.`);
                // We might want to remove it from gameObjects or change its appearance
            }
            return gathered;
        }
    }

    function renderMinimap() {
        // Clear minimap
        minimapCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);

        // Draw minimap background (optional, if different from game canvas bg)
        minimapCtx.fillStyle = '#222'; // Dark background for minimap
        minimapCtx.fillRect(0, 0, minimapCanvas.width, minimapCanvas.height);

        // Draw border for the entire map
        minimapCtx.strokeStyle = '#555';
        minimapCtx.lineWidth = 1;
        minimapCtx.strokeRect(0, 0, minimapCanvas.width, minimapCanvas.height);

        // Draw game objects
        gameObjects.forEach(obj => {
            if (obj.isDestroyed) return; // Don't draw destroyed objects

            const minimapX = obj.x * MINIMAP_SCALE_X;
            const minimapY = obj.y * MINIMAP_SCALE_Y;
            let minimapColor = 'gray'; // Default
            let minimapSize = 2;

            if (obj.type === 'CommandCenter' || obj.type === 'Barracks') {
                minimapColor = obj.isAI ? 'orange' : 'blue'; // AI buildings orange, player blue
                minimapSize = obj.isConstructing ? 3 : 4; // Slightly larger, indicate if constructing
            } else if (obj.isUnit) {
                if (obj.type === 'Collector') {
                    minimapColor = obj.isAI ? 'yellow' : 'aqua'; // AI collectors yellow
                } else { // Combat units
                    minimapColor = obj.isAI ? 'pink' : 'red'; // AI combat units pink
                }
                minimapSize = 2;
            } else if (obj.type === 'ResourceNode') {
                if (obj.resourceType === 'minerals') {
                    minimapColor = 'cyan';
                } else if (obj.resourceType === 'gas') {
                    minimapColor = 'lightgreen';
                }
                minimapSize = 1;
            }

            minimapCtx.fillStyle = minimapColor;
            minimapCtx.fillRect(minimapX - minimapSize / 2, minimapY - minimapSize / 2, minimapSize, minimapSize);
        });

        // Optional: Draw current viewport on minimap (assuming no scrolling for now, viewport is full map)
        // If scrolling is implemented, gameCanvas.viewportX, gameCanvas.viewportY would be needed.
        // For now, the viewport is the entire map, so no special rectangle needed unless we zoom.
    }

    let lastTime = 0;
    // --- Game Loop ---
    function gameLoop(timestamp) {
        const deltaTime = (timestamp - lastTime) || 0; // Ensure deltaTime is not NaN on first frame
        lastTime = timestamp;

        update(deltaTime); // Pass deltaTime to update
        render();
        requestAnimationFrame(gameLoop);
    }

    // --- Update Function ---
    function update(deltaTime) { // deltaTime is in milliseconds
        // Update game logic here
        mineralsDisplay.textContent = playerResources.minerals;
        gasDisplay.textContent = playerResources.gas;
        if (currentSupplyDisplay && maxSupplyDisplay) {
            currentSupplyDisplay.textContent = playerResources.currentSupply;
            maxSupplyDisplay.textContent = playerResources.maxSupply;
        }

        gameObjects.forEach(obj => {
            if (obj.update) {
                obj.update(deltaTime / 1000); // Pass deltaTime in seconds
            }
        });

        if (selectedObject) {
            selectedEntityDisplay.textContent = `${selectedObject.emoji} ${selectedObject.type}`; // Added emoji
            if (selectedObject.hp !== undefined && selectedObject.maxHp !== undefined) {
                entityHPDisplay.textContent = `HP: ${selectedObject.hp}/${selectedObject.maxHp}`;
            } else {
                entityHPDisplay.textContent = 'HP: N/A';
            }

            // Additional info for specific types
            if (selectedObject.type === 'ResourceNode') {
                entityHPDisplay.textContent += ` | Amount: ${selectedObject.amount} ${selectedObject.resourceType}`; 
            } else if (selectedObject.type === 'Collector') {
                entityHPDisplay.textContent += ` | Load: ${selectedObject.currentLoad}/${selectedObject.carryCapacity}`;
                 if (selectedObject.resourceType && selectedObject.currentLoad > 0) {
                    entityHPDisplay.textContent += ` (${selectedObject.resourceType})`;
                }
            }

        } else {
            selectedEntityDisplay.textContent = 'None';
            entityHPDisplay.textContent = 'N/A';
        }
        updateBuildQueueDisplay(); // Call this each frame

        // Handle Object Destruction and Removal
        // const initialObjectCount = gameObjects.length; // Not strictly needed with new logic
        let supplyBuildingDestroyed = false; 
        let selectedObjectWasDestroyed = false;

        gameObjects = gameObjects.filter(obj => {
            if (obj.isDestroyed) {
                if (obj.isBuilding && obj.supplyProvided > 0) {
                    supplyBuildingDestroyed = true;
                }
                // If the destroyed object was selected, clear the selection
                if (obj === selectedObject) {
                    selectedObject = null;
                    selectedObjectWasDestroyed = true; // Flag that selection was cleared
                }
                // When a unit is destroyed, free up its supply
                if (obj.isUnit && obj.supplyCost > 0) {
                    playerResources.currentSupply -= obj.supplyCost;
                    // Ensure currentSupply doesn't go below zero, though it shouldn't
                    playerResources.currentSupply = Math.max(0, playerResources.currentSupply); 
                    console.log(`${obj.type} destroyed. Supply freed. Current supply: ${playerResources.currentSupply}/${playerResources.maxSupply}`);
                } else if (obj.isBuilding) { // Log building destruction
                    console.log(`${obj.type} destroyed.`);
                }
                return false; // Remove from gameObjects
            }
            return true; // Keep in gameObjects
        });

        if (supplyBuildingDestroyed) {
            updateMaxSupply(); // Recalculate max supply if a supply building was destroyed
        }
        if (selectedObjectWasDestroyed) { // If selected object was destroyed and nulled
            updateCommandPanel(); // Refresh command panel
            updateBuildQueueDisplay(); // Refresh build queue
        }
    }

    // --- Render Function ---
    function render() {
        // Clear canvas
        ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
        ctx.fillStyle = '#202020'; // Dark grey background for map
        ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

        // Render game objects (units, buildings, resources)
        gameObjects.forEach(obj => {
            if (obj.render) {
                obj.render(ctx);
            } else { // Basic emoji rendering
                ctx.font = obj.size ? `${obj.size}px Arial` : '24px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(obj.emoji || '❓', obj.x, obj.y);
            }
        });

        // Render selection indicator (example)
        if (selectedObject) {
            ctx.strokeStyle = 'yellow';
            ctx.lineWidth = 2;
            const selectSize = (selectedObject.size || 24) * 1.5; // Make selection box a bit larger
            ctx.strokeRect(
                selectedObject.x - selectSize / 2,
                selectedObject.y - selectSize / 2,
                selectSize,
                selectSize
            );
        }
        
        // Render buildingToPlace ghost at mouse position
        if (gameState === 'placing_building' && buildingToPlace) {
            ctx.globalAlpha = 0.5;
            ctx.font = `${buildingToPlace.size}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(buildingToPlace.emoji, currentMousePosition.x, currentMousePosition.y);
            ctx.globalAlpha = 1.0;
        }
        renderMinimap(); // Call the new minimap rendering function
    }

    // --- Input Handling ---
    gameCanvas.addEventListener('mousemove', (event) => {
        const rect = gameCanvas.getBoundingClientRect();
        currentMousePosition.x = event.clientX - rect.left;
        currentMousePosition.y = event.clientY - rect.top;
    });

    gameCanvas.addEventListener('click', (event) => {
        const rect = gameCanvas.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const clickY = event.clientY - rect.top;
        // console.log(`Canvas clicked at: X=${clickX}, Y=${clickY}`); // Reduced console spam

        let newSelection = null; // Potential new selection based on click

        if (gameState === 'awaiting_attack_target' && selectedObject && selectedObject.attack) {
            let clickedOnTarget = null;
            for (const obj of gameObjects) {
                // Check if the clicked object is a valid target (has HP, not self, not allied if that logic existed)
                if (obj !== selectedObject && obj.hp !== undefined && obj.hp > 0 /* && !obj.isDestroyed */) {
                    const objSize = obj.size || 24;
                    if (
                        clickX >= obj.x - objSize / 2 && clickX <= obj.x + objSize / 2 &&
                        clickY >= obj.y - objSize / 2 && clickY <= obj.y + objSize / 2
                    ) {
                        clickedOnTarget = obj;
                        break;
                    }
                }
            }

            if (clickedOnTarget) {
                selectedObject.attackTarget = clickedOnTarget;
                selectedObject.action = 'moving_to_attack';
                setGameStatusMessage(`${selectedObject.emoji} attacking ${clickedOnTarget.emoji}.`, 3000);
            } else {
                setGameStatusMessage('Attack command cancelled: Invalid target.', 3000);
            }
            gameState = 'normal'; // Reset state
            // updateCommandPanel(); // Called at the end of the click handler

        } else if (gameState === 'placing_building' && buildingToPlace) {
            if (playerResources.minerals >= buildingToPlace.cost) {
                playerResources.minerals -= buildingToPlace.cost;
                const newBuilding = new Building(
                    clickX,
                    clickY,
                    buildingToPlace.emoji,
                    buildingToPlace.type,
                    1, // Start with 1 HP, construction will increase it
                    buildingToPlace.size
                );
                newBuilding.isPlaced = false; // Not yet fully placed
                newBuilding.isConstructing = true;
                newBuilding.buildProgress = 0;
                newBuilding.totalBuildTime = buildingToPlace.totalBuildTime;
                newBuilding.maxHp = buildingToPlace.hp; // Set final maxHp
                newBuilding.hp = 1; // Start with minimal HP during construction

                // Initialize unitBuildTimes for Barracks if relevant
                if (newBuilding.type === 'Barracks') {
                    // unitBuildTimes are now set via updateCommandPanel when Barracks is selected
                }

                gameObjects.push(newBuilding);
                console.log(`${buildingToPlace.type} placement started at (${clickX}, ${clickY}).`);
                gameState = 'normal';
                buildingToPlace = null;
            } else {
                alert('Not enough minerals! (Cost: ' + buildingToPlace.cost + ')');
                gameState = 'normal'; // Exit placement mode if somehow stuck
                buildingToPlace = null;
            }
        } else if (gameState === 'awaiting_gather_target' && selectedObject && selectedObject.type === 'Collector') {
            let clickedOnNode = null;
            for (const obj of gameObjects) {
                if (obj.type === 'ResourceNode') {
                    const objSize = obj.size || 24;
                    if (
                        clickX >= obj.x - objSize / 2 && clickX <= obj.x + objSize / 2 &&
                        clickY >= obj.y - objSize / 2 && clickY <= obj.y + objSize / 2
                    ) {
                        clickedOnNode = obj;
                        break;
                    }
                }
            }
            if (clickedOnNode) {
                selectedObject.gatherFrom(clickedOnNode);
                setGameStatusMessage(`${selectedObject.emoji} ordered to gather from ${clickedOnNode.emoji}.`, 3000);
            } else {
                // Clicked on empty ground or invalid target
                setGameStatusMessage('Gather command cancelled: Invalid target.', 3000);
            }
            gameState = 'normal'; // Reset state
        } else { // Normal selection/command logic
            // Determine what was clicked on
            for (let i = gameObjects.length - 1; i >= 0; i--) {
                const obj = gameObjects[i];
                const objSize = obj.size || 24;
                if (
                    clickX >= obj.x - objSize / 2 && clickX <= obj.x + objSize / 2 &&
                    clickY >= obj.y - objSize / 2 && clickY <= obj.y + objSize / 2
                ) {
                    newSelection = obj; // This is the object the player clicked on
                    break;
                }
            }

            if (selectedObject && selectedObject.isUnit && newSelection && newSelection !== selectedObject && newSelection.hp !== undefined) {
                // If a unit is already selected, and player clicks another valid target object (not self, has HP)
                if (selectedObject.attack) { // Check if the selected unit has an attack method
                    selectedObject.attackTarget = newSelection;
                    selectedObject.action = 'moving_to_attack'; // Start moving towards target
                    console.log(`${selectedObject.type} targeting ${newSelection.type} (${newSelection.emoji})`);
                    // Don't change selection, keep the current unit selected to see its actions
                } else { // Non-combat unit clicked another object, default to selection
                     // Deselect previous selectedObject by setting its selected flag to false
                    if(selectedObject) selectedObject.selected = false;
                    selectedObject = newSelection; // Change selection
                    if (selectedObject) selectedObject.selected = true;
                }
            } else if (selectedObject && selectedObject.isUnit && !newSelection) {
                // Unit selected, clicked on empty ground: Move command
                selectedObject.moveTo(clickX, clickY);
                if (selectedObject.attackTarget) { // Clear attack target if moving manually
                    selectedObject.attackTarget = null;
                    // action will be set to 'moving' by moveTo
                }
            } else { // Default selection logic: clicked on an object without a unit pre-selected, or clicked empty ground with no unit selected
                if(selectedObject) selectedObject.selected = false;
                selectedObject = newSelection;
                if (selectedObject) selectedObject.selected = true;
            }
        }
        
        // Update selected status for all objects based on the final selectedObject
        gameObjects.forEach(obj => {
            obj.selected = (obj === selectedObject);
        });
        // console.log('Selected:', selectedObject ? `${selectedObject.type} (${selectedObject.emoji})` : 'None'); // Reduced console spam
        updateCommandPanel();
    });

    // --- UI Updates ---
    function updateCommandPanel() {
        commandPanel.innerHTML = ''; // Clear old commands

        // Clear placement mode if it's active and a new command is issued by selecting an existing object
        if (gameState === 'placing_building' && selectedObject) { 
            setGameStatusMessage('Building placement cancelled.', 2000);
            gameState = 'normal';
            buildingToPlace = null;
        }

        if (selectedObject) {
            // Example: Add a "Move" button if a unit is selected
            if (selectedObject.isUnit) {
                const stopButton = document.createElement('button');
                stopButton.textContent = 'Stop (S)';
                stopButton.onclick = () => {
                    if (selectedObject && selectedObject.stop) {
                        selectedObject.stop();
                        setGameStatusMessage(`${selectedObject.emoji} stopped.`, 2000);
                        if (gameState === 'awaiting_gather_target' || gameState === 'awaiting_attack_target') {
                            gameState = 'normal'; // Also cancel targeting mode
                        }
                    }
                };
                commandPanel.appendChild(stopButton);

                // The old "Move (M)" button was here. It has been removed as per instructions.
                // Movement is now handled by selecting a unit and clicking on the ground.

                if (selectedObject.attack) { // Check if unit has attack capability
                    const attackButton = document.createElement('button');
                    attackButton.textContent = 'Attack (A)';
                    attackButton.onclick = () => {
                        // alert('Select a target to attack.'); // REMOVE THIS
                        setGameStatusMessage('Awaiting attack target: Click an enemy unit or building.', 5000);
                        gameState = 'awaiting_attack_target'; 
                    };
                    commandPanel.appendChild(attackButton);
                }

                if (selectedObject.type === 'Collector') {
                    const gatherButton = document.createElement('button');
                    gatherButton.textContent = 'Gather (G)';
                    gatherButton.onclick = () => {
                        // alert('Select a resource node to gather from.'); // REMOVE THIS
                        setGameStatusMessage('Awaiting resource target: Click a mineral or gas node.', 5000);
                        // Set a game state to expect a resource node click
                        gameState = 'awaiting_gather_target'; 
                    };
                    commandPanel.appendChild(gatherButton);
                }

            } else if (selectedObject.type === 'CommandCenter') {
                const buildCollectorButton = document.createElement('button');
                buildCollectorButton.textContent = 'Build Collector (C) - 50M'; // M for Minerals
                buildCollectorButton.onclick = () => {
                    const collectorCost = 50; 
                    const collectorSupplyCost = 1; // Defined for Collector

                    // Check supply first
                    if (playerResources.currentSupply + collectorSupplyCost <= playerResources.maxSupply) {
                        // Then check resources
                        if (playerResources.minerals >= collectorCost) {
                            if (selectedObject.productionQueue.length < 5) { 
                                playerResources.minerals -= collectorCost;
                                selectedObject.productionQueue.push('Collector');
                                setGameStatusMessage('Collector queued for production.', 3000);
                                updateBuildQueueDisplay(); 
                            } else {
                                setGameStatusMessage('Production queue is full!', 3000);
                            }
                        } else {
                            setGameStatusMessage(`Not enough minerals for Collector! Need ${collectorCost}.`, 3000);
                        }
                    } else {
                        // Not enough supply
                        setGameStatusMessage(`Not enough supply for Collector! Need ${collectorSupplyCost} supply. Max: ${playerResources.maxSupply}.`, 4000);
                    }
                };
                commandPanel.appendChild(buildCollectorButton);

                const buildBarracksButton = document.createElement('button');
                buildBarracksButton.textContent = 'Build Barracks (B) - 150M';
                buildBarracksButton.onclick = () => {
                    if (playerResources.minerals >= 150) {
                        gameState = 'placing_building';
                        buildingToPlace = {
                            type: 'Barracks',
                            emoji: '🏭',
                            hp: 1000,
                            size: 55,
                            cost: 150, // Cost for Barracks
                            totalBuildTime: 10000 // 10 seconds for Barracks
                        };
                        setGameStatusMessage('Placing Barracks: Click on map to build.', 5000);
                    } else {
                        setGameStatusMessage(`Not enough minerals for Barracks! Need 150.`, 3000);
                    }
                };
                commandPanel.appendChild(buildBarracksButton);

            } else if (selectedObject.type === 'Barracks') {
                if (selectedObject.isConstructing) {
                    const statusText = document.createElement('p');
                    statusText.textContent = `Constructing... ${Math.floor((selectedObject.buildProgress / selectedObject.totalBuildTime) * 100)}%`;
                    commandPanel.appendChild(statusText);
                } else if (selectedObject.isPlaced) {
                    const unitProductionInfo = {
                        'Soldier': { cost: { minerals: 75, gas: 0 }, emoji: '💂', buildTime: 7000, supplyCost: 1 },
                        'SuperSoldier': { cost: { minerals: 125, gas: 50 }, emoji: '🦸', buildTime: 10000, supplyCost: 2 },
                        'Tank': { cost: { minerals: 200, gas: 100 }, emoji: '🚜', buildTime: 15000, supplyCost: 3 }
                    };

                    // Make sure Barracks has its unitBuildTimes initialized
                    if (!selectedObject.unitBuildTimes || Object.keys(selectedObject.unitBuildTimes).length === 0) {
                        selectedObject.unitBuildTimes = {};
                        for (const unit in unitProductionInfo) {
                            selectedObject.unitBuildTimes[unit] = unitProductionInfo[unit].buildTime;
                        }
                    }

                    for (const unitName in unitProductionInfo) {
                        const info = unitProductionInfo[unitName];
                        const button = document.createElement('button');
                        button.textContent = `Build ${info.emoji} ${unitName} - ${info.cost.minerals}M ${info.cost.gas}G`;
                        button.onclick = () => {
                            const unitDetails = unitProductionInfo[unitName];
                            // Check supply first
                            if (playerResources.currentSupply + unitDetails.supplyCost <= playerResources.maxSupply) {
                                // Then check resources
                                if (playerResources.minerals >= unitDetails.cost.minerals && playerResources.gas >= unitDetails.cost.gas) {
                                    if (selectedObject.productionQueue.length < 5) { // Max 5 items in queue
                                        playerResources.minerals -= unitDetails.cost.minerals;
                                        playerResources.gas -= unitDetails.cost.gas;
                                        selectedObject.productionQueue.push(unitName);
                                        setGameStatusMessage(`${unitName} queued for production.`, 3000);
                                        updateBuildQueueDisplay();
                                    } else {
                                        setGameStatusMessage('Production queue is full!', 3000);
                                    }
                                } else {
                                    setGameStatusMessage(`Not enough resources for ${unitName}! Need ${unitDetails.cost.minerals}M ${unitDetails.cost.gas}G.`, 3000);
                                }
                            } else {
                                // Not enough supply
                                setGameStatusMessage(`Not enough supply for ${unitName}! Need ${unitDetails.supplyCost} supply. Max: ${playerResources.maxSupply}.`, 4000);
                            }
                        };
                        commandPanel.appendChild(button);
                    }
                }
            }
            // More command buttons will be added here based on object type
        }
    }

    // Initialize game entities
    const mineralNode1 = new ResourceNode(100, 100, '💎', 'minerals', 1500);
    const mineralNode2 = new ResourceNode(700, 500, '💎', 'minerals', 1500);
    const gasNode1 = new ResourceNode(100, 500, '💨', 'gas', 1000, 35); // Gas emoji might be different
    const gasNode2 = new ResourceNode(700, 100, '💨', 'gas', 1000, 35);
    gameObjects.push(mineralNode1, mineralNode2, gasNode1, gasNode2);

    const commandCenter = new Building(MAP_WIDTH / 2, MAP_HEIGHT / 2, '🏠', 'CommandCenter', 1500, 60, false); // Player's CC
    commandCenter.resourceGenerationRate = 1; // Generates 1 mineral per second
    commandCenter.isPlaced = true; // Starts fully built
    commandCenter.isConstructing = false;
    commandCenter.unitBuildTimes = { 'Collector': 5000 }; // Specific to CommandCenter
    commandCenter.supplyProvided = 10; // <-- Add this line
    gameObjects.push(commandCenter);
    updateMaxSupply(); // <-- Add this call

    // AI Player Resources
    let aiPlayerResources = {
        minerals: 500,
        gas: 200,
        currentSupply: 0,
        maxSupply: 0
    };

    // Initial AI Placement
    const aiStartX = MAP_WIDTH - 100;
    const aiStartY = 100;

    // AI CommandCenter
    const aiCommandCenter = new Building(aiStartX, aiStartY, '🏠', 'CommandCenter', 1500, 60, true); // isAI = true
    aiCommandCenter.isPlaced = true; 
    aiCommandCenter.supplyProvided = 10;
    aiCommandCenter.resourceGenerationRate = 1; 
    gameObjects.push(aiCommandCenter);
    aiPlayerResources.maxSupply += aiCommandCenter.supplyProvided;

    // AI Starting Collectors
    for (let i = 0; i < 3; i++) {
        // Spawn AI collectors slightly offset from their CC and each other
        const collector = new Collector(aiStartX + 60 + (i * 10), aiStartY + (i * 10), true); // isAI = true
        // supplyCost is already set in Collector constructor (defaults to 1 if not specified, but explicitly set to 1 in prior step)
        gameObjects.push(collector);
        aiPlayerResources.currentSupply += collector.supplyCost;
    }
    
    // Initialize and start game
    console.log("Game starting...");
    gameLoop(0); // Start the game loop with an initial timestamp
});
