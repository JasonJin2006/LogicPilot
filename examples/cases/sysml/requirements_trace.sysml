// SysML integration level 1: structure + requirement traceability only.
// A pure engineering model intentionally exposes no execution target.
package SensorSystem {
  part def Sensor {
    attribute accuracy = 0.99;
    port data;
  }

  part def Controller {
    port input;
  }

  requirement AccuracyRequirement;
  requirement ConnectivityRequirement;

  satisfy requirement AccuracyRequirement by Sensor;
  satisfy requirement ConnectivityRequirement by Controller;
  connect Sensor to Controller;
}
