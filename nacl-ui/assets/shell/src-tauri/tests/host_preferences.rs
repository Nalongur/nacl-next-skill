use nacl_next_s1_shell::preferences::{HostPreferences, read_preferences, save_preferences};
use nacl_next_sdk::context::SdkContext;
#[test]
fn missing_defaults_are_not_written_and_valid_save_survives_reload() {
    let root=tempfile::tempdir().unwrap();let context=SdkContext::from_root(root.path());context.initialize().unwrap();
    assert_eq!(read_preferences(&context).unwrap(),HostPreferences::default());
    assert!(!context.config_root.join("host-preferences.json").exists());
    let prefs=HostPreferences{schema_version:1,default_memory_mb:6144,default_window_width:1600,default_window_height:900};
    save_preferences(&context,&prefs).unwrap();assert_eq!(read_preferences(&context).unwrap(),prefs);
}
#[test]
fn corrupt_or_invalid_existing_preferences_are_never_overwritten() {
    let root=tempfile::tempdir().unwrap();let context=SdkContext::from_root(root.path());context.initialize().unwrap();let path=context.config_root.join("host-preferences.json");
    let invalid:Vec<Vec<u8>>=vec![vec![0xff],b"{".to_vec(),br#"{"schemaVersion":2,"defaultMemoryMb":4096,"defaultWindowWidth":1280,"defaultWindowHeight":720}"#.to_vec(),br#"{"schemaVersion":1,"defaultMemoryMb":"4096","defaultWindowWidth":1280,"defaultWindowHeight":720}"#.to_vec(),br#"{"schemaVersion":1,"defaultMemoryMb":4096,"defaultWindowWidth":1280}"#.to_vec(),br#"{"schemaVersion":1,"defaultMemoryMb":1023,"defaultWindowWidth":1280,"defaultWindowHeight":720}"#.to_vec()];
    for bytes in invalid {std::fs::write(&path,&bytes).unwrap();assert!(read_preferences(&context).is_err());assert!(save_preferences(&context,&HostPreferences::default()).is_err());assert_eq!(std::fs::read(&path).unwrap(),bytes);}
}
#[test]
fn rejects_invalid_save_and_preserves_previous_file() {
    let root=tempfile::tempdir().unwrap();let context=SdkContext::from_root(root.path());context.initialize().unwrap();let valid=HostPreferences::default();save_preferences(&context,&valid).unwrap();let path=context.config_root.join("host-preferences.json");let before=std::fs::read(&path).unwrap();
    for p in [HostPreferences{default_memory_mb:32769,..valid.clone()},HostPreferences{default_window_width:853,..valid.clone()},HostPreferences{default_window_height:4321,..valid.clone()},HostPreferences{schema_version:2,..valid.clone()}] {assert!(save_preferences(&context,&p).is_err());assert_eq!(std::fs::read(&path).unwrap(),before);}
}
#[cfg(windows)]
#[test]
fn replace_failure_keeps_previous_file() {
    use std::os::windows::fs::OpenOptionsExt;
    let root=tempfile::tempdir().unwrap();let context=SdkContext::from_root(root.path());context.initialize().unwrap();let valid=HostPreferences::default();save_preferences(&context,&valid).unwrap();let path=context.config_root.join("host-preferences.json");let before=std::fs::read(&path).unwrap();
    let hold=std::fs::OpenOptions::new().read(true).share_mode(1).open(&path).unwrap();
    assert!(save_preferences(&context,&HostPreferences{default_memory_mb:6144,..valid}).is_err());drop(hold);assert_eq!(std::fs::read(path).unwrap(),before);
}
#[test]
fn creation_uses_saved_defaults_without_changing_existing_instance() {
    use nacl_next_s1_shell::{commands::create_instance_with_preferences,state::ShellState};
    use nacl_next_sdk::instance::{self,CreateInstanceRequest};
    let root=tempfile::tempdir().unwrap();let context=SdkContext::from_root(root.path());
    #[cfg(not(feature="microsoft"))] let state=ShellState::new(context).unwrap();
    #[cfg(feature="microsoft")] let state=ShellState::new(context,None).unwrap();
    let request=|name:&str|CreateInstanceRequest{name:name.into(),game_version:"1.21.1".into()};
    let old=create_instance_with_preferences(&state,request("old")).unwrap();
    save_preferences(&state.context,&HostPreferences{schema_version:1,default_memory_mb:6144,default_window_width:1600,default_window_height:900}).unwrap();
    let new=create_instance_with_preferences(&state,request("new")).unwrap();
    assert_eq!(new.memory.minimum_mb,1024);assert_eq!(new.memory.maximum_mb,6144);assert_eq!((new.display.width,new.display.height),(1600,900));
    assert_eq!(instance::find_instance(&state.context,&old.id).unwrap(),old);
    std::fs::write(state.context.config_root.join("host-preferences.json"),b"bad").unwrap();
    assert!(create_instance_with_preferences(&state,request("blocked")).is_err());assert_eq!(instance::list_instances(&state.context).unwrap().len(),2);
}
#[test]
fn second_valid_save_replaces_first_and_survives_new_context() {
    let root = tempfile::tempdir().unwrap();
    let context = SdkContext::from_root(root.path());
    context.initialize().unwrap();
    let first = HostPreferences { schema_version: 1, default_memory_mb: 6144, default_window_width: 1600, default_window_height: 900 };
    let second = HostPreferences { schema_version: 1, default_memory_mb: 8192, default_window_width: 1920, default_window_height: 1080 };
    save_preferences(&context, &first).unwrap();
    save_preferences(&context, &second).unwrap();
    assert_eq!(read_preferences(&SdkContext::from_root(root.path())).unwrap(), second);
}
