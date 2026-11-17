// Bridge Panic: the silly technical names of the controls (every control name is unique across the crew) and the
// two positions of a lever.
export const CONTROL_NAMES: readonly string[] = [
  "Bilge Organ", "Flux Damper", "Port Kettle", "Starboard Kettle", "Gimbal Trumpet", "Rudder Biscuit",
  "Spindle Fan", "Ballast Whistle", "Torque Pudding", "Mast Doorbell", "Cog Toaster", "Vent Parliament",
  "Plasma Teapot", "Hatch Chorus", "Anchor Sprocket", "Sonar Pickle", "Boiler Bagpipe", "Lantern Clutch",
  "Chart Accordion", "Winch Pillow", "Gasket Choir", "Pylon Kazoo", "Funnel Dial", "Trim Banjo",
  "Throttle Goose", "Piston Jelly", "Valve Harp", "Capstan Mitten", "Keel Tickler", "Radar Muffin",
  "Boom Spanner", "Gyro Waffle", "Davit Bell", "Sump Trombone", "Horn Governor", "Kelp Filter",
  "Engine Sofa", "Bulkhead Hum", "Compass Soup", "Steam Cushion", "Ratchet Duck", "Wheel Blender",
  "Siren Biscuit", "Rivet Printer", "Tiller Pedal", "Cable Mop", "Turbine Slipper", "Beacon Kettledrum",
  "Fog Lever", "Hawser Piano", "Mizzen Lamp", "Clutch Parrot", "Depth Pretzel", "Funnel Radio",
  "Pump Violin", "Shackle Drum", "Prop Oven", "Slate Winch", "Coil Pantry", "Orbit Latch",
  "Brine Switch", "Hull Bagel", "Skylight Gong", "Deck Cannon", "Cleat Bugle", "Swivel Pie",
  "Mooring Fridge", "Reactor Spoon", "Bellows Console", "Tackle Whistle", "Foghorn Valve", "Sextant Fizz",
  "Barometer Sock", "Jib Trampoline", "Davy Crank", "Quad Ratchet", "Tarpaulin Pump", "Lifebuoy Gear",
  "Buoy Humidifier", "Sail Cannon", "Ember Gauge", "Pilot Ladle", "Grease Carousel", "Stern Lantern",
  "Lug Tuner", "Sluice Drum", "Gale Dispenser", "Mess Thruster", "Thimble Brake", "Plank Radar",
  "Harbour Zipper", "Torch Bellows", "Swell Fader", "Haze Pedal", "Carriage Plug", "Dynamo Squeak",
  "Ledger Piston", "Bosun Dimmer", "Galley Rudder", "Flare Pantry", "Trawl Switch", "Crown Gasket",
  "Anvil Wheel", "Mop Reactor", "Stoker Pillar", "Fathom Fan", "Pitch Doorknob", "Bunker Lamp",
  "Chain Locker", "Sump Doorbell", "Yardarm Pump", "Crow Valve", "Ripple Cog", "Lamp Governor",
  "Tide Cabinet", "Wick Spindle", "Clam Booster", "Scupper Dial", "Gantry Trumpet", "Hub Lasso",
  "Grapnel Fiddle", "Cistern Flap", "Vane Biscuit", "Wren Regulator", "Ohm Parrot", "Plumb Kettle",
];

/** The two ends of a lever: state 0 is the first word, state 1 the second. */
export const LEVER_ENDS: ReadonlyArray<readonly [string, string]> = [
  ["Fore", "Aft"], ["Up", "Down"], ["Open", "Shut"], ["Raise", "Lower"], ["Left", "Right"], ["Hot", "Cold"],
  ["Rise", "Sink"], ["Lock", "Free"],
];
