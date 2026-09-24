#define MyAppName "SOKNA Agent"
#define MyAppVersion "2.6.0-dev"
#define MyPublisher "SOKNA"
#define MyExeName "Sokna.Agent.Maintenance.exe"
#define PayloadRoot "..\..\artifacts\windows\installer-payload"

[Setup]
AppId={{B9415F43-B17D-4D47-AED0-0D804F1A4679}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyPublisher}
DefaultDirName={localappdata}\Programs\SOKNA Agent
DefaultGroupName=SOKNA Agent
DisableProgramGroupPage=no
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
WizardStyle=modern
OutputDir=..\..\artifacts\windows\setup
OutputBaseFilename=SOKNA-Agent-Setup-{#MyAppVersion}-x64
Compression=lzma2/ultra64
SolidCompression=yes
CloseApplications=yes
RestartApplications=no
RestartIfNeededByRun=no
SetupLogging=yes
UninstallLogging=yes
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyExeName}
ChangesEnvironment=no

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut for SOKNA Agent status"; GroupDescription: "Additional shortcuts:"; Flags: unchecked
Name: "autostart"; Description: "Start SOKNA Agent automatically when I sign in"; GroupDescription: "Startup:"; Flags: checkedonce

[Files]
Source: "{#PayloadRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\SOKNA Agent Status"; Filename: "{app}\{#MyExeName}"; Parameters: "status --install-root ""{app}"""; WorkingDir: "{app}"
Name: "{group}\Create Support Bundle"; Filename: "{app}\{#MyExeName}"; Parameters: "support-bundle --install-root ""{app}"" --output ""{userdocs}\SOKNA-Agent-Support.zip"""; WorkingDir: "{app}"
Name: "{group}\Extension Files"; Filename: "{app}\extension"; Flags: foldershortcut
Name: "{userdesktop}\SOKNA Agent Status"; Filename: "{app}\{#MyExeName}"; Parameters: "status --install-root ""{app}"""; Tasks: desktopicon; WorkingDir: "{app}"

[Registry]
Root: HKCU; Subkey: "Software\Google\Chrome\NativeMessagingHosts\com.sokna.bridge.v3"; ValueType: string; ValueName: ""; ValueData: "{app}\native-host\com.sokna.bridge.v3.json"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Microsoft\Edge\NativeMessagingHosts\com.sokna.bridge.v3"; ValueType: string; ValueName: ""; ValueData: "{app}\native-host\com.sokna.bridge.v3.json"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "SOKNA Agent"; ValueData: """{app}\Sokna.Agent.Launcher.exe"" start --install-root ""{app}"""; Tasks: autostart; Flags: uninsdeletevalue

[UninstallRun]
Filename: "{app}\{#MyExeName}"; Parameters: "uninstall-prep --install-root ""{app}"""; Flags: runhidden skipifdoesntexist

[Code]
var
  ArtifactRootPage: TInputDirWizardPage;

function GetArtifactRoot(Param: String): String;
begin
  Result := ArtifactRootPage.Values[0];
end;

procedure InitializeWizard;
begin
  ArtifactRootPage := CreateInputDirPage(wpSelectDir,
    'Artifact storage',
    'Choose the managed SOKNA Agent ArtifactRoot.',
    'Agent-managed downloads, staging, browser QA artifacts, and cleanup stay inside this folder. ' +
    'SOKNA Agent never automatically deletes files outside this root.'#13#10#13#10 +
    'Click Next to keep the recommended location or Browse to choose another folder.',
    False, SetupMessage(msgNewFolderName));
  ArtifactRootPage.Add('');
  ArtifactRootPage.Values[0] := ExpandConstant('{param:ArtifactRoot|{localappdata}\SOKNA\Bridge\artifacts}');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  P: String;
begin
  Result := True;
  if CurPageID = ArtifactRootPage.ID then
  begin
    P := Trim(ArtifactRootPage.Values[0]);
    if (P = '') or (not PathIsRooted(P)) then
    begin
      SuppressibleMsgBox('ArtifactRoot must be an absolute path.', mbError, MB_OK, IDOK);
      Result := False;
    end
    else if PathStartsWith(AddBackslash(P), AddBackslash(WizardDirValue), True) or
            PathStartsWith(AddBackslash(WizardDirValue), AddBackslash(P), True) then
    begin
      SuppressibleMsgBox('ArtifactRoot and the application install folder cannot contain one another. Choose separate folders so lifecycle cleanup cannot affect artifact data.', mbError, MB_OK, IDOK);
      Result := False;
    end;
  end;
end;

procedure RunRequired(const Action, Params: String);
var
  ResultCode: Integer;
  FullParams: String;
begin
  FullParams := Action + ' --install-root "' + ExpandConstant('{app}') + '" ' + Params;
  Log('Maintenance action: ' + Action);
  if not Exec(ExpandConstant('{app}\{#MyExeName}'), FullParams, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    RaiseException('Unable to execute maintenance action ' + Action + ': ' + SysErrorMessage(ResultCode));
  if ResultCode <> 0 then
    RaiseException('Maintenance action ' + Action + ' failed with exit code ' + IntToStr(ResultCode) + '. Review the Setup and maintenance logs.');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  LogDir, DestLog: String;
begin
  if CurStep = ssPostInstall then
  begin
    RunRequired('initialize', '--artifact-root "' + GetArtifactRoot('') + '"');
    RunRequired('start', '--expected-version "2.6.0"');
  end;
  if CurStep = ssDone then
  begin
    LogDir := ExpandConstant('{app}\logs\installer');
    ForceDirectories(LogDir);
    DestLog := LogDir + '\setup-' + GetDateTimeString('yyyymmdd-hhnnss', '-', ':') + '.log';
    if ExpandConstant('{log}') <> '' then
      FileCopy(ExpandConstant('{log}'), DestLog, False);
  end;
end;
