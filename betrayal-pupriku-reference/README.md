# Betrayal at House on the Hill - Unreal Engine 5 Adaptation

This project is a digital adaptation of the popular board game "Betrayal at House on the Hill," being developed in Unreal Engine 5. The primary goal is to create a visually engaging and atmospheric multiplayer experience.

**Repository:** [https://github.com/PupRiku/BetrayalGame.git](https://github.com/PupRiku/BetrayalGame.git)

## Current Project Status (As of July 2025)

The project has achieved a complete, playable "vertical slice." All foundational systems are in place, including a data-driven framework for characters, rooms, and all card types. The core gameplay loop, from pre-Haunt exploration to a fully functional Haunt scenario with win conditions, is complete. Current development is focused on expanding content and adding high-fidelity visual and gameplay polish.

## Features Implemented:

### 1. Player & Character Systems

- **Data-Driven Characters (`DT_Characters`):** A Data Table stores definitions for each unique character, including their **unique stat tracks**, color, and portrait.
- **Stat Management:** Robust functions handle stat modification (`ChangeStat`) and restoration (`RestoreStatToStart`).
- **Player Inventory & Interaction:** A complete inventory system allows players to use, drop, pick up, and trade items through a polished, animated UI. The system respects item-specific rules (`bIsTradable`, `bIsDroppable`, etc.).
- **Rule-Accurate Movement:** Player movement is governed by "Movement Points" derived from their current Speed stat. The system correctly handles rules for movement being stopped by card draws or hindered by opponents during the Haunt.
- **Status Effects:** The character can be affected by persistent status effects like "Immobilized" (from Debris/Webs), "Soiled", and "Darkness", which apply specific penalties and have unique cure conditions.
- **Player Death:** A robust death mechanic correctly checks if damage is lethal during the Haunt and handles player elimination.

### 2. Turn & Game State Management

- **Game State Machine (`EGameState`):** The Game Mode tracks the current game phase (`PreHaunt_Exploration`, `Haunt_HeroesTurn`, `Haunt_TraitorTurn`, `GameEnd_...`).
- **Haunt Turn Structure:** A complete turn manager correctly cycles through each individual Hero's turn before passing control to the Traitor and their monsters.
- **Action Tracking:** The system tracks and enforces "once per turn" rules for actions like attacking and using specific items.

### 3. Dice, Combat, & Damage

- **Flexible Combat System:** A universal `ResolveCombat` function handles all combat scenarios (Player vs. Player, Monster vs. Player, etc.).
- **Player-Initiated Combat:** An `IA_Attack` input allows the player to initiate an attack, correctly disabled before the Haunt begins.
- **Interactive Combat & Damage:** The system presents UI choices to the player for abilities that modify combat (e.g., **Ring**, **Steal**) and damage (e.g., **Skull**, **Damage Allocation**).
- **Item & Haunt Rule Integration:** The combat logic correctly checks for weapon bonuses (Spear, Axe), special damage types (Mummy), and immunities.

### 4. Exploration & Room System

- **Data-Driven Rooms (`DT_RoomTiles`):** A fully populated Data Table defines all official rooms with their doors, windows, and special rule flags.
- **Interactable World Objects:** The game supports persistent, interactable objects spawned in rooms by events (e.g., Closet Door, Locked Safe).
- **Advanced Connection Logic:** A `FinalizeRoomConnections` function intelligently handles room placement, preventing overlaps, creating automatic door-to-door connections, and correctly identifying "false features" (blocked doors/windows). Special connections like stairs and passages are also supported.
- **Programmatic Starting Layout:** At game start, the `CreateStartingLayout` function correctly builds the multi-floor starting area of the house.
- **Pathfinding:** A `BP_HouseGraphManager` correctly maps all room connections, and a `FindShortestPath` function using a Breadth-First Search algorithm is implemented, with helpers to calculate distance.

### 5. Card & Event System

- **Complete Data Foundation & Decks:** Data Tables and shuffled, depleting decks are set up for Omens, Events, and Items.
- **Component-Based Card Effects:** A clean, scalable system where each card's unique logic is contained in its own Actor Component.
- **All Omen, Item, & Event Cards Implemented:** The logic for all card types has been implemented.

### 6. The Haunt

- **Complete Haunt Reveal Sequence:** The game correctly tracks the `OmenCardCount`, triggers a Haunt Roll, looks up the specific Haunt in the `DT_HauntChart`, determines the Traitor, and displays the secret objectives.
- **Monster System:** A `BP_Monster_Base` class has been created with stats, inventory, and logic for being stunned and taking a turn. The Game Mode contains a system to manage the "Monster Turn" phase.
- **Full Haunt Scenario Implemented:** The "The Mummy Walks" Haunt is fully playable with its unique setup, monster, special rules, and win conditions.

### 7. User Interface (UI)

- **Polished Player HUD (`WBP_PlayerHUD`):** Displays a character portrait in a custom frame, interactive stat tooltips, a custom room name plaque, an animated slide-out inventory, and dynamic status effect icons.
- **Animated Omen Counter:** A custom-themed UI element that displays the Omen count and plays a dynamic animation.
- **Modal Widgets:** A full suite of functional UI for Card Display, Haunt Briefings, and complex player choices.

## Up-to-Date Checklist: The Road to a Finished Game

- **Phase 1: Visual Foundation**

  - `[ ]` **Build Token and Room Geometry** (Next Up!)
  - `[ ]` Add Top-Down Map Display

- **Phase 2: Final Polish & Gameplay Completion**

  - `[ ]` Final UI Polish & Add HUD Icons
  - `[ ]` Testing and Reworking Complex Cards (e.g., Dog's Pathfinding)

- **Phase 3: Content Expansion**

  - `[ ]` Implement More Haunt Scenarios
  - `[ ]` Implement Haunt-Specific Monster Abilities

- **Phase 4: Major Feature Expansions**
  - `[ ]` Add AI Controlled "Players"
  - `[ ]` Multiplayer
