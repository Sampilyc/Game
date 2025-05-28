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
    const mineralsDisplay = document.getElementById('minerals');
    const gasDisplay = document.getElementById('gas');
    let gameState = 'normal'; // For handling specific input states like awaiting_gather_target
    let buildingToPlace = null;
    let currentMousePosition = { x: 0, y: 0 };
    const selectedEntityDisplay = document.getElementById('selected-entity');
    const entityHPDisplay = document.getElementById('entity-hp');
    const commandPanel = document.getElementById('command-panel');
    const unitQueueList = document.getElementById('unit-queue-list');
    // Minimap canvas (for later)
    // const minimapCanvas = document.getElementById('minimap-canvas');
    // const minimapCtx = minimapCanvas.getContext('2d');

    // Game state variables
    let playerResources = {
        minerals: 50, // Start with less, CC will generate
        gas: 0
    };
    let gameObjects = []; // To store all units, buildings, resources
    let selectedObject = null;

    class Building {
        constructor(x, y, emoji, type, hp, size = 50) {
            this.x = x;
            this.y = y;
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
                }
            }

            if (!this.isConstructing && this.isPlaced) {
                // Passive resource generation for specific buildings
                if (this.type === 'CommandCenter' && this.resourceGenerationRate > 0) {
                    this.lastResourceTick += deltaTime; // deltaTime is in seconds
                    if (this.lastResourceTick >= 1) { // Every 1 second
                        const ticks = Math.floor(this.lastResourceTick);
                        playerResources.minerals += this.resourceGenerationRate * ticks;
                        this.lastResourceTick -= ticks;
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

                        if (unitType === 'Collector') {
                            newUnit = new Collector(spawnX, spawnY);
                        } else if (unitType === 'Soldier') {
                            newUnit = new Soldier(spawnX, spawnY);
                        } else if (unitType === 'SuperSoldier') {
                            newUnit = new SuperSoldier(spawnX, spawnY);
                        } else if (unitType === 'Tank') {
                            newUnit = new Tank(spawnX, spawnY);
                        }

                        if (newUnit) {
                            gameObjects.push(newUnit);
                            console.log(`${unitType} built!`);
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
        constructor(x, y, emoji, type, hp, speed, size = 20) {
            this.x = x;
            this.y = y;
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
    }

    class Collector extends Unit {
        constructor(x, y) {
            super(x, y, '👷', 'Collector', 50, 60, 22); // x, y, emoji, type, hp, speed, size
            this.resourceType = null; // 'minerals' or 'gas'
            this.carryCapacity = 10;
            this.currentLoad = 0;
            this.targetResourceNode = null;
            this.homeBuilding = null; // To return resources
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
        constructor(x, y) {
            super(x, y, '💂', 'Soldier', 100, 50, 24); // x, y, emoji, type, hp, speed, size
            this.attackDamage = 10;
            this.attackRange = 80; // pixels
            this.attackSpeed = 1000; // ms per attack (1 attack per second)
            this.lastAttackTime = 0;
            this.attackTarget = null;
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
        constructor(x, y) {
            super(x, y, '🦸', 'SuperSoldier', 150, 55, 28);
            this.attackDamage = 20;
            this.attackRange = 100;
            this.attackSpeed = 1200;
            this.lastAttackTime = 0;
            this.attackTarget = null;
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
        constructor(x, y) {
            super(x, y, '🚜', 'Tank', 250, 35, 32);
            this.attackDamage = 35;
            this.attackRange = 150;
            this.attackSpeed = 2000;
            this.lastAttackTime = 0;
            this.attackTarget = null;
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
        const initialObjectCount = gameObjects.length;
        gameObjects = gameObjects.filter(obj => !obj.isDestroyed);
        if (gameObjects.length < initialObjectCount) {
            console.log(`${initialObjectCount - gameObjects.length} objects removed.`);
            if (selectedObject && selectedObject.isDestroyed) { // Clear selection if it was destroyed
                selectedObject = null;
                updateCommandPanel(); // Update panel if selection is cleared
            }
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

        if (gameState === 'placing_building' && buildingToPlace) {
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
            } else {
                // Clicked on empty ground, interpret as move command
                selectedObject.moveTo(clickX, clickY);
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
        if (selectedObject) {
            // Example: Add a "Move" button if a unit is selected
            if (selectedObject.isUnit) {
                const moveButton = document.createElement('button');
                moveButton.textContent = 'Move (M)';
                moveButton.onclick = () => alert('Move command issued for ' + selectedObject.emoji + '. Click on map to set destination.');
                // Actual move command is now issued by clicking on the map after selection
                commandPanel.appendChild(moveButton);

                if (selectedObject.type === 'Collector') {
                    const gatherButton = document.createElement('button');
                    gatherButton.textContent = 'Gather (G)';
                    gatherButton.onclick = () => {
                        alert('Select a resource node to gather from.');
                        // Set a game state to expect a resource node click
                        gameState = 'awaiting_gather_target'; 
                    };
                    commandPanel.appendChild(gatherButton);
                }

            } else if (selectedObject.type === 'CommandCenter') {
                const buildCollectorButton = document.createElement('button');
                buildCollectorButton.textContent = 'Build Collector (C) - 50M'; // M for Minerals
                buildCollectorButton.onclick = () => {
                    if (playerResources.minerals >= 50) {
                        playerResources.minerals -= 50; // Deduct cost
                        selectedObject.productionQueue.push('Collector'); // Add to building's queue
                        console.log('Queuing collector...');
                        updateBuildQueueDisplay(); // Explicitly update here for immediate feedback
                    } else {
                        alert('Not enough minerals!');
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
                            cost: 150,
                            totalBuildTime: 10000 // 10 seconds for Barracks
                        };
                        console.log('Entering placement mode for Barracks.');
                    } else {
                        alert('Not enough minerals for Barracks!');
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
                        'Soldier': { cost: { minerals: 75, gas: 0 }, emoji: '💂', buildTime: 7000 },
                        'SuperSoldier': { cost: { minerals: 125, gas: 50 }, emoji: '🦸', buildTime: 10000 },
                        'Tank': { cost: { minerals: 200, gas: 100 }, emoji: '🚜', buildTime: 15000 }
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
                            if (playerResources.minerals >= info.cost.minerals && playerResources.gas >= info.cost.gas) {
                                if (selectedObject.productionQueue.length < 5) { // Max 5 items in queue
                                    playerResources.minerals -= info.cost.minerals;
                                    playerResources.gas -= info.cost.gas;
                                    selectedObject.productionQueue.push(unitName);
                                    console.log(`Queueing ${unitName}`);
                                    updateBuildQueueDisplay(); // Update UI immediately
                                } else {
                                    alert('Production queue is full!');
                                }
                            } else {
                                alert(`Not enough resources for ${unitName}!`);
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

    const commandCenter = new Building(MAP_WIDTH / 2, MAP_HEIGHT / 2, '🏠', 'CommandCenter', 1500, 60);
    commandCenter.resourceGenerationRate = 1; // Generates 1 mineral per second
    commandCenter.isPlaced = true; // Starts fully built
    commandCenter.isConstructing = false;
    commandCenter.unitBuildTimes = { 'Collector': 5000 }; // Specific to CommandCenter
    gameObjects.push(commandCenter);
    
    // Initialize and start game
    console.log("Game starting...");
    gameLoop(0); // Start the game loop with an initial timestamp
});
