// Generated from libraries/process.lplib by
// scripts/gen-stdlib-header.mjs - DO NOT EDIT BY HAND.
// Regenerate after editing the library file: node scripts/gen-stdlib-header.mjs
#pragma once

namespace logicpilot::dsl {

// Embedded standard process library source (block shapes). The compiler
// loads it into the block registry at analyze time. Stored in chunks
// because MSVC rejects single string literals beyond ~16 KiB.
inline const char* const kStdlibProcessChunks[] = {
    R"lp(// Generated from libraries/pml-catalog.json by
// scripts/gen-process-lplib.mjs - DO NOT EDIT BY HAND.
// Regenerate after editing the catalog:
//   node scripts/gen-process-lplib.mjs
//   node scripts/gen-stdlib-header.mjs
library process {
  version = 1

  // ResourcePool (0 port(s), 61 properties)
  block resource {
    type: string = "resource_moving"
    capacityDefinitionType: string = "capacity_direct"
    capacity: int = 1
    destroyExcessUnits: bool = false
    capacityBasedOnAttractors: bool = false
    capacitySchedule: int = 0
    capacityScheduleOnOff: bool = false
    capacityWhenOn: int = 1
    shiftGroupSchedules: int = 0
    shiftGroupSizes: int = 0
    shiftGroupsPlan: int = 0
    newResourceUnit: expression = "Agent"
    speed: float = 10
    homeNodes: ref = ""
    showDefaultAnimationStatic: bool = false
    downtimeSource: string = ""
    downtimeList: expression = ""
    enableMaintenance: bool = false
    initialTimeToMaintenance: float = 0
    timeToNextMaintenance: float = 0
    maintenancePriority: float = 100
    maintenanceMayPreempt: bool = false
    maintenanceType: string = ""
    taskStartBlockMaintenance: expression = ""
    maintenanceTime: float = 0
    usageStatisticsAre: string = "usage_not_counted"
    enableFailuresRepairs: bool = false
    initialTimeToFailure: distribution = exponential(1)
    timeToNextFailure: float = 0
    countBusyOnlyTimeToFailure: bool = false
    repairType: string = ""
    taskStartBlockRepair: expression = ""
    timeToRepair: float = 0
    enableBreaks: bool = false
    breaksSchedule: bool = false
    breakPriority: float = 50
    breakMayPreempt: bool = false
    breakPreemptionPolicy: string = "pp_terminate"
    enableCustomTasks: bool = false
    customTasks: expression = ""
    endOfShiftPriority: float = 100
    endOfShiftMayPreempt: bool = false
    endOfShiftPreemptionPolicy: string = "pp_no_preemption"
    customizeRequestChoice: bool = false
    requestChoiceCondition: bool = true
    addToCustomPopulation: bool = false
    population: ref = ""
    forceStatisticsCollection: bool = false
    onNewUnit: expression = ""
    onDestroyUnit: expression = ""
    onSeize: expression = ""
    onRelease: expression = ""
    onWrapUp: expression = ""
    onUnitStateChanged: expression = ""
    onMaintenanceStart: expression = ""
    onMaintenanceEnd: expression = ""
    onFailure: expression = ""
    onRepair: expression = ""
    onBreakStart: expression = ""
    onBreakEnd: expression = ""
    onBreakTerminated: expression = ""
    failure_rate: float = 0
    repair_rate: float = 1
  }

  // Source (1 port(s), 41 properties)
  block source {
    out out: entity

    arrivalType: string = "rate"
    arrival: distribution = rate(1)
    interarrivalTime: distribution = exponential(1)
    firstArrivalMode: string = "after_timeout"
    firstArrivalTime: float = 0
    databaseTable: expression = ""
    arrivalDate: expression = ""
    rateSchedule: expression = ""
    modifyRate: bool = false
    rateExpression: float = 0
    arrivalSchedule: int = 0
    setAgentParametersFromDB: bool = false
    multipleEntitiesPerArrival: bool = false
    agentsPerArrival: int = 0
    limitArrivals: bool = false
    maxArrivals: int = 0
    locationType: string = "location_not_specified"
    node: ref = ""
    attractor: expression = ""
    xYZ: float = 0
    destinationInNetwork: bool = false
    level: expression = ""
    network: ref = ""
    latitudeLongitude: float = 0
    nameOfPlace: string = ""
    speed: float = 10
    newAgent: expression = "Agent"
    changeDimensions: bool = false
    length: float = 0
    width: float = 0
    height: float = 0
    enableCustomStartTime: bool = false
    startTime: float = 0
    addToCustomPopulation: bool = false
    population: expression = ""
    pushProtocol: bool = true
    discardHangingEntities: bool = true
    onBeforeArrival: expression = ""
    onAtExit: expression = ""
    onExit: expression = ""
    onDiscard: expression = ""
  }

  // Queue (4 port(s), 17 properties)
  block queue {
    in in: entity
    out out: entity
    out outTimeout: entity when enableTimeout
    out outPreempted: entity when enablePreemption

    capacity: int = 100
    maximumCapacity: bool = false
    entityLocation: expression = ""
    queuing: string = "queuing_fifo"
    agentPriority: float = 0
    agent1IsPreferredToAgent2: bool = false
    enableTimeout: bool = false
    timeout: float = 100
    enablePreemption: bool = false
    restoreEntityLocationOnExit: bool = true
    forceStatisticsCollection: bool = false
    onEnter: expression = ""
    onAtExit: expression = ""
    onExit: expression = ""
    onExitPreempted: expression = ""
    onExitTimeout: expression = ""
    onRemove: expression = ""
  }

  // Delay (2 port(s), 12 properties)
  block delay {
    in in: entity
    out out: entity

    type: string = "timeout"
    delayTime: float = 0
    capacity: int = 1
    maximumCapacity: bool = false
    entityLocation: expression = ""
    pushProtocol: bool = false
    restoreEntityLocationOnExit: bool = true
    forceStatisticsCollection: bool = false
    onEnter: expression = ""
    onAtExit: expression = ""
    onExit: expression = ""
    onRemove: expression = ""
  }

  // Service (4 port(s), 44 properties)
  block service {
    in in: entity
    out out: entity
    out outTimeout: entity when enableTimeout
    out outPreempted: entity when enablePreemption

    seizeFromOnePool: bool = true
    resourceSetsAlternatives: expression = ""
    resource: ref = ""
    numberOfUnits: int = 1
    queueCapacity: int = 100
    maximumCapacity: bool = false
    time: distribution = exponential(1)
    sendSeizedResources: bool = false
    destinationType: string = ""
    node: ref = ""
    attractor: expression = ""
    onFinishMovingResources: bool = true
    entityLocationQueue: expression = ""
    entityLocationDelay: expression = ""
    taskPriority: float = 0
    taskMayPreempt: bool = true
    taskPreemptionPolicy: string = ""
    suspendResumeEntities: bool = true
    enterForTerminatedAgents: expression = ""
    returnHome: string = ""
    wrapUpPriority: float = 0
    wrapUpPreemptionPolicy: string = ""
    customizeResourceChoice: bool = false
    resourceChoiceCondition: bool = true
    resourceSelection: string = "resource_selection_some_unit"
    unit1IsPreferredToUnit2: bool = false
    unitRating: float = 0
    enableTimeout: bool = false
    timeout: float = 100
    enablePreemption: bool = false
    restoreEntityLocationOnExit: bool = false
    forceStatisticsCollection: bool = false
    returnHomeUsageIs: string = "usage_busy"
    onEnter: expression = ""
    onExitTimeout: expression = ""
    onExitPreempted: expression = ""
    onSeizeUnit: expression = ""
    onEnterDelay: expression = ""
    onAtExit: expression = ""
    onExit: expression = ""
    onTaskSuspended: expression = ""
    onTaskResumed: expression = ""
    onTaskTerminated: expression = ""
    onRemove: expression = ""
  }

  // Split (3 port(s), 21 properties)
  block split {
    in in: entity
    out out: entity
    out outCopy: entity

    numberOfCopies: int = 0
    newAgentCopy: expression = ""
    changeDimensions: bool = false
    length: float = 0
    width: float = 0
    height: float = 0
    locationType: string = ""
    node: ref = ""
    attractor: expression = ""
    xYZ: float = 0
    destinationInNetwork: bool = false
    level: expression = ""
    network: ref = ""
    latitudeLongitude: float = 0
    nameOfPlace: string = ""
    speed: float = 10
    addToCustomPopulation: bool = false
    population: ref = ""
    onEnter: expression = ""
    onExitCopy: expression = ""
    onExitOriginal: expression = ""
  }

  // Combine (3 port(s), 16 properties)
  block combine {
    in in1: entity
    in in2: entity
    out out: entity

    combineMode: string = ""
    newAgentCombined: ref = ""
    changeDimensions: bool = false
    length: float = 0
    width: float = 0
  )lp",
    R"lp(  height: float = 0
    entityLocation1: expression = ""
    entityLocation2: expression = ""
    entityLocation: expression = ""
    addToCustomPopulation: bool = false
    population: ref = ""
    pushProtocol: bool = false
    restoreEntityLocationOnExit: bool = true
    onEnter1: expression = ""
    onEnter2: expression = ""
    onExit: expression = ""
  }

  // Batch (2 port(s), 27 properties)
  block batch {
    in in: entity
    out out: entity

    batchSize: int = 10
    permanent: bool = false
    newBatch: expression = "Agent"
    changeDimensions: bool = false
    length: float = 0
    width: float = 0
    height: float = 0
    entityLocation: expression = ""
    locationType: string = "location_not_specified"
    node: expression = ""
    attractor: expression = ""
    xYZ: float = 0
    destinationInNetwork: bool = false
    level: expression = ""
    network: ref = ""
    latitudeLongitude: float = 0
    nameOfPlace: string = ""
    speed: float = 10
    addToCustomPopulation: bool = false
    population: ref = ""
    pushProtocol: bool = false
    restoreEntityLocationOnExit: bool = true
    forceStatisticsCollection: bool = false
    onEnter: expression = ""
    onAdd: expression = ""
    onExit: expression = ""
    onRemove: expression = ""
  }

  // Unbatch (2 port(s), 15 properties)
  block unbatch {
    in in: entity
    out out: entity

    batchType: expression = "Agent"
    elementType: expression = "Agent"
    sameAsBatchLocation: bool = true
    locationType: string = ""
    node: ref = ""
    attractor: expression = ""
    xYZ: float = 0
    locationXYZInNetwork: bool = false
    level: expression = ""
    network: ref = ""
    latitudeLongitude: float = 0
    nameOfPlace: string = ""
    pushProtocol: bool = false
    onEnter: expression = ""
    onExit: expression = ""
  }

  // Seize (5 port(s), 44 properties)
  block seize {
    in in: entity
    out outTimeout: entity when enableTimeout
    out outPreempted: entity when enablePreemption
    out out: entity
    out preparedUnits: entity

    seizeFromOnePool: bool = true
    resourceSets: ref = ""
    resource: ref = ""
    numberOfUnits: int = 0
    seizePolicy: string = "seize_whole_set"
    capacity: int = 100
    maximumCapacity: bool = false
    sendSeizedResources: bool = false
    destinationType: string = ""
    node: ref = ""
    attractor: expression = ""
    attachSeizedResources: bool = false
    entityLocationQueue: expression = ""
    taskPriority: float = 0
    taskMayPreempt: bool = true
    taskPreemptionPolicy: string = "pp_no_preemption"
    suspendResumeEntities: bool = true
    terminatedTaskProcessing: string = ""
    enterForTerminatedAgents: expression = ""
    customizeResourceChoice: bool = false
    resourceChoiceCondition: bool = true
    dispatchingPolicy: string = ""
    unit1IsPreferredToUnit2: bool = false
    unitRating: float = 0
    taskStartBlocksAreConnected: bool = true
    taskStartBlocks: expression = ""
    enableTimeout: bool = false
    timeout: float = 100
    enablePreemption: bool = false
    canceledUnitsBehavior: string = "canceled_units_stay_where_they_are"
    releaseForCanceledUnits: expression = ""
    pushProtocol: bool = false
    restoreEntityLocationOnExit: bool = false
    forceStatisticsCollection: bool = false
    onEnter: expression = ""
    onExitTimeout: expression = ""
    onExitPreempted: expression = ""
    onSeizeUnit: expression = ""
    onPrepareUnit: expression = ""
    onExit: expression = ""
    onTaskSuspended: expression = ""
    onTaskResumed: expression = ""
    onTaskTerminated: expression = ""
    onRemove: expression = ""
  }

  // Release (3 port(s), 14 properties)
  block release {
    in in: entity
    out wrapUp: entity
    out out: entity

    releaseMode: string = ""
    seizeBlocks: expression = ""
    resourcepoolObjects: ref = ""
    resourcePoolBlock: ref = ""
    quantityReleased: int = 0
    movingResources: bool = true
    wrapUpEGMoveHome: string = ""
    wrapUpPriority: float = 0
    wrapUpPreemptionPolicy: string = ""
    wrapUpUsageStatisticsAre: string = ""
    onEnter: expression = ""
    onRelease: expression = ""
    onExit: expression = ""
    onWrapUpTerminated: expression = ""
  }

  // Wait (4 port(s), 17 properties)
  block wait {
    in in: entity
    out out: entity
    out outTimeout: entity when enableTimeout
    out outPreempted: entity when enablePreemption

    capacity: int = 100
    maximumCapacity: bool = false
    entityLocation: expression = ""
    enableTimeout: bool = false
    timeout: float = 100
    enablePreemption: bool = false
    queuing: string = ""
    agentPriority: float = 0
    agent1MayPreemptAgent2: bool = false
    pushProtocol: bool = false
    restoreEntityLocationOnExit: bool = true
    forceStatisticsCollection: bool = false
    onEnter: expression = ""
    onExit: expression = ""
    onExitPreempted: expression = ""
    onExitTimeout: expression = ""
    onRemove: expression = ""
  }

  // Hold (2 port(s), 5 properties)
  block hold {
    in in: entity
    out out: entity

    mode: string = "manual"
    nEntitiesForSelfBlock: int = 0
    blockingCondition: bool = false
    initiallyBlocked: bool = false
    onEnter: expression = ""
  }

  // Match (8 port(s), 30 properties)
  block match {
    in in1: entity
    in in2: entity
    out out1: entity
    out out2: entity
    out outTimeout1: entity when enableTimeout1
    out outTimeout2: entity when enableTimeout2
    out outPreempted1: entity when enablePreemption1
    out outPreempted2: entity when enablePreemption2

    matchCondition: bool = true
    capacity1: int = 100
    maximumCapacity1: bool = false
    capacity2: int = 100
    maximumCapacity2: bool = false
    entityLocation1: expression = ""
    entityLocation2: expression = ""
    queuing1: string = ""
    agentPriority1: float = 0
    agent1IsPreferredToAgent21: bool = false
    queuing2: string = ""
    agentPriority2: float = 0
    agent1IsPreferredToAgent22: bool = false
    enableTimeout1: bool = false
    timeout1: float = 0
    enableTimeout2: bool = false
    timeout2: float = 0
    enablePreemption1: bool = false
    enablePreemption2: bool = false
    restoreEntityLocationOnExit: bool = true
    forceStatisticsCollection: bool = false
    onEnter1: expression = ""
    onEnter2: expression = ""
    onMatch: expression = ""
    onExit1: expression = ""
    onExit2: expression = ""
    onExitTimeout1: expression = ""
    onExitTimeout2: expression = ""
    onExitPreempted1: expression = ""
    onExitPreempted2: expression = ""
  }

  // SelectOutput (3 port(s), 7 properties)
  block selectOutput {
    in in: entity
    out outT: entity
    out outF: entity

    conditionIsProbabilistic: bool = true
    probability: float = 0.5
    condition: bool = true
    conditionIsStochasticOrVolatile: bool = false
    onEnter: expression = ""
    onExitTrue: expression = ""
    onExitFalse: expression = ""
  }

  // Enter (1 port(s), 21 properties)
  block enter {
    out out: entity

    agentType: expression = "Agent"
    locationType: string = "location_not_specified"
    node: ref = ""
    attractor: expression = ""
    xYZ: float = 0
    destinationInNetwork: bool = false
    level: expression = ""
    network: ref = ""
    latitudeLongitude: float = 0
    nameOfPlace: string = ""
    speed: float = 10
    changeDimensions: bool = false
    length: float = 1
    width: float = 1
    height: float = 1
    addToCustomPopulation: bool = false
    population: ref = ""
    pushProtocol: bool = true
    onEnter: expression = ""
    onRemove: expression = ""
    onAtEnter: expression = ""
  }

  // Exit (1 port(s), 1 properties)
  block exit {
    in in: entity

    onExit: expression = ""
  }

  // MoveTo (2 port(s), 25 properties)
  block moveTo {
    in in: entity
    out out: entity

    destinationType: string = ""
    node: ref = ""
    attractor: expression = ""
    resource: ref = ""
    agent: ref = ""
    xYZ: float )lp",
    R"lp(= 0
    latitudeLongitude: float = 0
    nameOfPlace: string = ""
    destinationUseRotation: bool = false
    rotation: float = 0
    verticalRotation: float = 0
    useOffsets: bool = false
    xYZOffset: float = 0
    destinationInNetwork: bool = false
    network: ref = ""
    level: expression = ""
    straightMovement: bool = false
    movementIsDefinedBy: expression = ""
    setAgentSSpeed: bool = false
    speed: float = 0
    tripTime: float = 0
    restoreSpeedOnArrival: bool = false
    onEnter: expression = ""
    onExit: expression = ""
    onRemove: expression = ""
  }

  // TimeMeasureStart (2 port(s), 1 properties)
  block timeMeasureStart {
    in in: entity
    out out: entity

    onEnter: expression = ""
  }

  // TimeMeasureEnd (2 port(s), 5 properties)
  block timeMeasureEnd {
    in in: entity
    out out: entity

    startObjects: expression = ""
    datasetCapacity: int = 100
    onEnter: expression = ""
    datasetDataset: expression = ""
    histogramdataDistribution: expression = ""
  }

  // Assembler (3 port(s), 44 properties)
  block assembler {
    in in: entity
    in p1: entity
    out out: entity

    quantity125: int = 0
    newAgent: expression = "Agent"
    changeDimensions: bool = false
    length: float = 0
    width: float = 0
    height: float = 0
    seizeFromOnePool: bool = false
    resourceSets: ref = ""
    resourcePool: ref = ""
    numberOfUnits: int = 0
    delayTime: float = 0
    outputBufferCapacity: int = 0
    locationType: string = "location_not_specified"
    node: ref = ""
    attractor: expression = ""
    xYZ: float = 0
    destinationInNetwork: bool = false
    level: expression = ""
    network: ref = ""
    latitudeLongitude: float = 0
    nameOfPlace: string = ""
    speed: float = 10
    entityLocationDelay: expression = ""
    agentLocationQueue1Queue5: expression = ""
    taskPriority: float = 0
    taskMayPreempt: bool = true
    taskPreemptionPolicy: string = "pp_no_preemption"
    suspendResumeEntities: bool = true
    enterForTerminatedAgents: expression = ""
    customizeResourceChoice: bool = false
    resourceChoiceCondition: bool = true
    resourceSelection: string = "resource_selection_some_unit"
    unit1IsPreferredToUnit2: bool = false
    unitRating: float = 0
    addToCustomPopulation: bool = false
    population: ref = ""
    forceStatisticsCollection: bool = false
    onEnter125: expression = ""
    onEnterDelay: expression = ""
    onAtExit: expression = ""
    onExit: expression = ""
    onTaskSuspended: expression = ""
    onTaskResumed: expression = ""
    onTaskTerminated: expression = ""
  }

  // Count (2 port(s), 0 properties)
  block count {
    in in: entity
    out out: entity

  }

  // Sink (1 port(s), 1 properties)
  block sink {
    in in: entity

    onEnter: expression = ""
  }
}

)lp"
};

inline std::string stdlib_process_source() {
  std::string source;
  for (const char* chunk : kStdlibProcessChunks) {
    source += chunk;
  }
  return source;
}

}  // namespace logicpilot::dsl
