use nacl_next_s1_shell::commands::InstanceIpc;
use nacl_next_sdk::{context::SdkContext, instance::{self, CreateInstanceRequest, InstanceConfig, InstanceDefaults}};

#[test]
fn instance_ipc_preserves_exact_timestamp_and_rejects_numbers() {
    let root = tempfile::tempdir().unwrap();
    let context = SdkContext::from_root(root.path());
    let mut instance = instance::create_instance(&context, CreateInstanceRequest {
        name: "fixture".into(), game_version: "1.21.1".into(),
    }, &InstanceDefaults::default()).unwrap();
    instance.installation.installed_epoch_ms = Some(9007199254740993);
    let value = serde_json::to_value(InstanceIpc::from(instance.clone())).unwrap();
    assert_eq!(value["installation"]["installedEpochMs"], "9007199254740993");
    let back: InstanceIpc = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(instance, back.into());
    let mut bad = value;
    bad["installation"]["installedEpochMs"] = serde_json::json!(123);
    assert!(serde_json::from_value::<InstanceIpc>(bad).is_err());
}

#[test]
fn timestamps_round_trip_without_touching_other_fields_and_invalid_input_is_rejected() {
    let root = tempfile::tempdir().unwrap();
    let context = SdkContext::from_root(root.path());
    let mut original = instance::create_instance(&context, CreateInstanceRequest {
        name: "fixture".into(), game_version: "1.21.1".into(),
    }, &InstanceDefaults::default()).unwrap();
    let path = context.instances_root.join(&original.id).join("instance.json");
    for value in [None, Some(0), Some(1700000000000), Some(9007199254740993), Some(u128::MAX)] {
        original.installation.installed_epoch_ms = value;
        instance::update_instance(&context, original.clone()).unwrap();
        let read = instance::find_instance(&context, &original.id).unwrap();
        assert_eq!(read, original);
        let wire = serde_json::to_value(InstanceIpc::from(read)).unwrap();
        assert_eq!(wire["installation"]["installedEpochMs"], value.map(|v| serde_json::json!(v.to_string())).unwrap_or(serde_json::Value::Null));
        let mut round_trip: InstanceConfig = serde_json::from_value::<InstanceIpc>(wire).unwrap().into();
        round_trip.name = "edited".into();
        instance::update_instance(&context, round_trip.clone()).unwrap();
        assert_eq!(instance::find_instance(&context, &original.id).unwrap(), round_trip);
        let disk = std::fs::read_to_string(&path).unwrap();
        let expected = value.map(|v| v.to_string()).unwrap_or_else(|| "null".into());
        assert!(disk.contains(&format!("\"installedEpochMs\": {expected}")), "{disk}");
    }
    let before = std::fs::read(&path).unwrap();
    let good = serde_json::to_value(InstanceIpc::from(original)).unwrap();
    for bad in [serde_json::json!(""), serde_json::json!("-1"), serde_json::json!("1.0"), serde_json::json!("+1"), serde_json::json!("340282366920938463463374607431768211456"), serde_json::json!(42), serde_json::json!({})] {
        let mut wire = good.clone();
        wire["installation"]["installedEpochMs"] = bad;
        assert!(serde_json::from_value::<InstanceIpc>(wire).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
    let mut missing = good.clone();
    missing["installation"].as_object_mut().unwrap().remove("installedEpochMs");
    let missing: InstanceConfig = serde_json::from_value::<InstanceIpc>(missing).unwrap().into();
    assert_eq!(missing.installation.installed_epoch_ms, None);
    let mut missing_installation = good;
    missing_installation.as_object_mut().unwrap().remove("installation");
    let missing_installation: InstanceConfig = serde_json::from_value::<InstanceIpc>(missing_installation).unwrap().into();
    assert_eq!(missing_installation.installation, Default::default());
}
