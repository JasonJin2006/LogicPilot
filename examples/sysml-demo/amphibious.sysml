// 规范化演示变体（build/sysml-demo, 由源模型 current/ 人工转写）
// 源: 陆空两栖机器人/sysml-models - 压载水舱多域协同巡检系统
// 转写规则(仅命名): 中文标识符 -> ASCII 等价名; 注释保留原名。
//   GroundMotherPlatform  = 地面母平台,  FlyingPlatform  = 飞行器
//   DockingMechanismState = 伸缩对接机构状态, GroundPlatformWorkState = 地面母平台工作状态
//   AirGroundLinkState    = 空地协同状态
package AmphibiousSystem {
  // 00_公共定义 / 03_行为与状态定义 中的可复用动作
  package BehaviorDefinition {
    action def LinkAction;       // 空地平台连接
    action def DetachAction;     // 空地平台分离
    action def UnlockAndDeploy;  // 解除行驶锁并弹簧展开
    action def WedgeRetract;     // 无人机下压楔块收缩定心
    action def MechanicalLock;   // 正向机械锁死
    action def EmergencyRetract; // 执行无机应急收回
    action def RestoreDriveLock; // 解除对接并恢复行驶锁
  }
  // 03_行为与状态定义::状态定义 - 地面母平台工作状态
  package StateDefinition {
    state def GroundPlatformWorkState {
      state mobileInspection;    // 移动巡检
      state parkingOperation;    // 驻停作业
      transition mobileInspection then parkingOperation after 60 s;
      transition parkingOperation then mobileInspection after 30 s;
    }
    state def DockingMechanismState {
      state driveLocked;         // 行驶锁定
      state unfolding;           // 展开接机
      state dockingLocked;       // 对接锁死
      state emergencyRetract;    // 应急收回
      transition driveLocked then unfolding after 15 s;
      transition unfolding then dockingLocked after 20 s;
      transition unfolding then emergencyRetract after 8 s;
      transition emergencyRetract then driveLocked after 12 s;
      transition dockingLocked then driveLocked after 25 s;
    }
    state def AirGroundLinkState {
      state linked;              // 连接
      state separated;           // 分离
      transition linked then separated after 10 s;
      transition separated then linked after 10 s;
    }
  }
  // 04_系统架构 - 系统组成（部件类型引用合成 part def）
  part def FlyingPlatform {
    part battery;                // 动力电池
    part motorUnit;              // 无刷电机
    part propeller;              // 螺旋桨
    part flightController;       // 飞控
    part onboardComputer;        // 机载计算机
    part depthCamera;            // 深度相机
    attribute moving = false;    // 运动中
  }
  part def GroundMotherPlatform {
    part chassis;                // 底盘车架
    part mecanumWheel;           // 麦克纳姆轮
    part driveMotor;             // 驱动电机
    part mainController;         // 主控制器
    part dockingMechanism;       // 伸缩自定心对接机构
    attribute taskModuleWorking = false; // 任务模块作业中
  }
  // 08_系统需求 / 09_分析 / 10_验证 的代表条目
  requirement def ClearanceRequirement;   // 舱内作业净空需求
  analysis def BehaviorAnalysis;          // 行为分析用例
  verification def DockingVerification;   // 对接验证用例
}
