using Microsoft.Win32;
using System.Diagnostics;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Sokna.Bridge.ControlCenter;

internal sealed class MainForm : Form
{
    private readonly string _installRoot = Path.GetFullPath(AppContext.BaseDirectory);
    private readonly Label _status = new();
    private readonly Label _version = new();
    private readonly Label _port = new();
    private readonly Label _artifact = new();
    private readonly Label _workspaceCount = new();
    private readonly Label _lastError = new();
    private readonly TextBox _errorDetails = new();
    private readonly Panel _errorPanel = new();
    private readonly TextBox _diagnosticsBox = new();
    private readonly Label _diagnosticsStatus = new();
    private string _lastMaintenanceAction = "";
    private string[] _lastMaintenanceArgs = Array.Empty<string>();
    private readonly NumericUpDown _portInput = new();
    private readonly TextBox _artifactInput = new();
    private readonly CheckBox _autostart = new();
    private readonly ListView _workspaces = new();
    private readonly Label _extensionInfo = new();
    private readonly Button _saveSettings = new();
    private bool _busy;

    private static readonly string[] DevelopmentTools =
    [
        "git","git.exe","gh","gh.exe","dotnet","dotnet.exe","python","python.exe","py","py.exe",
        "node","node.exe","npm","npm.cmd","npx","npx.cmd","powershell","powershell.exe",
        "pwsh","pwsh.exe","cmd","cmd.exe","php","php.exe","composer","composer.bat","browser"
    ];

    internal MainForm()
    {
        Text = "SOKNA Bridge Control Center";
        Width = 1020;
        Height = 740;
        MinimumSize = new Size(900, 620);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Tahoma", 10f);
        RightToLeft = RightToLeft.Yes;
        RightToLeftLayout = true;

        var tabs = new TabControl { Dock = DockStyle.Fill, RightToLeft = RightToLeft.Yes, RightToLeftLayout = true, Padding = new Point(14, 6) };
        tabs.TabPages.Add(BuildHomeTab());
        tabs.TabPages.Add(BuildWorkspaceTab());
        tabs.TabPages.Add(BuildSettingsTab());
        tabs.TabPages.Add(BuildDiagnosticsTab());
        tabs.TabPages.Add(BuildGettingStartedTab());
        Controls.Add(tabs);

        Shown += async (_, _) => await RefreshAllAsync();
    }

    private TabPage BuildHomeTab()
    {
        var page = NewPage("وضعیت");
        var root = Stack();

        root.Controls.Add(new Label { Text = "SOKNA Bridge", AutoSize = true, Font = new Font(Font.FontFamily, 22f, FontStyle.Bold), Margin = new Padding(8, 14, 8, 2) });
        root.Controls.Add(new Label { Text = "وضعیت کلی، عملیات اصلی و آخرین خطای قابل اقدام را از این صفحه ببین.", AutoSize = true, ForeColor = Color.DimGray, Margin = new Padding(8, 0, 8, 16) });

        var health = Card("سلامت Agent");
        _status.AutoSize = true; _status.Font = new Font(Font.FontFamily, 14f, FontStyle.Bold); _status.Text = "در حال بررسی…"; _status.Margin = new Padding(8, 8, 8, 12);
        health.Controls.Add(_status);
        var info = new TableLayoutPanel { AutoSize = true, ColumnCount = 2, RightToLeft = RightToLeft.Yes, Padding = new Padding(8), Margin = new Padding(8), Width = 860 };
        info.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 220)); info.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        AddInfo(info, 0, "نسخه", _version); AddInfo(info, 1, "پورت محلی", _port); AddInfo(info, 2, "ArtifactRoot", _artifact); AddInfo(info, 3, "تعداد Workspace", _workspaceCount);
        health.Controls.Add(info);
        root.Controls.Add(health);

        var primary = Card("عملیات اصلی");
        var actions = ButtonRow();
        actions.Controls.Add(StyledButton("تازه‌سازی", async () => await RefreshAllAsync(), "primary"));
        actions.Controls.Add(StyledButton("شروع Agent", async () => await LifecycleAsync("start"), "secondary"));
        actions.Controls.Add(StyledButton("راه‌اندازی مجدد", async () => { await RunMaintenanceAsync("stop"); await RunMaintenanceAsync("start", "--expected-version", ReadProductVersion()); await RefreshAllAsync(); }, "secondary"));
        actions.Controls.Add(StyledButton("توقف Agent", async () => await LifecycleAsync("stop"), "danger"));
        primary.Controls.Add(actions);
        root.Controls.Add(primary);

        var maintenance = Card("نگهداری و پشتیبانی");
        var tools = ButtonRow();
        tools.Controls.Add(StyledButton("باز کردن Logها", () => OpenFolder(Path.Combine(_installRoot, "logs")), "secondary"));
        tools.Controls.Add(StyledButton("باز کردن ArtifactRoot", () => OpenFolder(CurrentArtifactRoot()), "secondary"));
        tools.Controls.Add(StyledButton("ساخت Support Bundle", CreateSupportBundleAsync, "secondary"));
        tools.Controls.Add(StyledButton("Diagnostics", async () => await RefreshDiagnosticsAsync(), "secondary"));
        maintenance.Controls.Add(tools);
        root.Controls.Add(maintenance);

        _errorPanel.AutoSize = true; _errorPanel.Width = 900; _errorPanel.Padding = new Padding(12); _errorPanel.Margin = new Padding(8); _errorPanel.BorderStyle = BorderStyle.FixedSingle; _errorPanel.Visible = false;
        var errorTitle = new Label { Text = "آخرین عملیات ناموفق بود", AutoSize = true, Font = new Font(Font.FontFamily, 12f, FontStyle.Bold), ForeColor = Color.Firebrick, Top = 10, Left = 690 };
        _lastError.AutoSize = false; _lastError.Width = 840; _lastError.Height = 46; _lastError.Top = 40; _lastError.Left = 20; _lastError.TextAlign = ContentAlignment.TopRight;
        _errorDetails.Multiline = true; _errorDetails.ReadOnly = true; _errorDetails.ScrollBars = ScrollBars.Vertical; _errorDetails.Width = 840; _errorDetails.Height = 110; _errorDetails.Top = 92; _errorDetails.Left = 20; _errorDetails.RightToLeft = RightToLeft.No; _errorDetails.Font = new Font("Consolas", 9f);
        var errButtons = new FlowLayoutPanel { Width = 840, Height = 48, Top = 208, Left = 20, FlowDirection = FlowDirection.RightToLeft };
        errButtons.Controls.Add(StyledButton("کپی جزئیات", () => Clipboard.SetText(_errorDetails.Text), "secondary"));
        errButtons.Controls.Add(StyledButton("باز کردن Logها", () => OpenFolder(Path.Combine(_installRoot, "logs", "maintenance")), "secondary"));
        errButtons.Controls.Add(StyledButton("Minimal Diagnostics", async () => await CreateMinimalDiagnosticsAsync(), "secondary"));
        errButtons.Controls.Add(StyledButton("تلاش مجدد", RetryLastMaintenanceAsync, "primary"));
        _errorPanel.Height = 272; _errorPanel.Controls.Add(errorTitle); _errorPanel.Controls.Add(_lastError); _errorPanel.Controls.Add(_errorDetails); _errorPanel.Controls.Add(errButtons);
        root.Controls.Add(_errorPanel);

        page.Controls.Add(root);
        return page;
    }

    private TabPage BuildDiagnosticsTab()
    {
        var page = NewPage("Diagnostics");
        var root = Stack();
        root.Controls.Add(SectionTitle("Diagnostics و خروجی پشتیبانی"));
        root.Controls.Add(new Label { Text = "این بخش برای عیب‌یابی است. خروجی‌ها Token و secret را نمایش نمی‌دهند.", AutoSize = true, ForeColor = Color.DimGray, Margin = new Padding(8) });
        var actions = ButtonRow();
        actions.Controls.Add(StyledButton("Refresh Diagnostics", RefreshDiagnosticsAsync, "primary"));
        actions.Controls.Add(StyledButton("Copy for AI", () => { if (!string.IsNullOrWhiteSpace(_diagnosticsBox.Text)) Clipboard.SetText(_diagnosticsBox.Text); }, "secondary"));
        actions.Controls.Add(StyledButton("Save JSON", SaveDiagnosticsAsync, "secondary"));
        actions.Controls.Add(StyledButton("Support Bundle", CreateSupportBundleAsync, "secondary"));
        actions.Controls.Add(StyledButton("Open Logs", () => OpenFolder(Path.Combine(_installRoot, "logs")), "secondary"));
        root.Controls.Add(actions);
        _diagnosticsStatus.AutoSize = true; _diagnosticsStatus.Margin = new Padding(8); root.Controls.Add(_diagnosticsStatus);
        _diagnosticsBox.Multiline = true; _diagnosticsBox.ReadOnly = true; _diagnosticsBox.ScrollBars = ScrollBars.Both; _diagnosticsBox.WordWrap = false; _diagnosticsBox.RightToLeft = RightToLeft.No; _diagnosticsBox.Font = new Font("Consolas", 9f); _diagnosticsBox.Width = 900; _diagnosticsBox.Height = 430; _diagnosticsBox.Margin = new Padding(8);
        root.Controls.Add(_diagnosticsBox);
        page.Controls.Add(root); return page;
    }

    private TabPage BuildSettingsTab()
    {
        var page = NewPage("تنظیمات / Settings");
        var root = Stack();

        root.Controls.Add(SectionTitle("تنظیمات Agent"));

        var portPanel = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.RightToLeft, WrapContents = false, Margin = new Padding(8) };
        portPanel.Controls.Add(new Label { Text = "پورت محلی:", AutoSize = true, Margin = new Padding(8) });
        _portInput.Minimum = 1024;
        _portInput.Maximum = 65535;
        _portInput.Value = 8766;
        _portInput.Width = 120;
        portPanel.Controls.Add(_portInput);
        root.Controls.Add(portPanel);

        var artifactPanel = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.RightToLeft, WrapContents = false, Margin = new Padding(8) };
        artifactPanel.Controls.Add(new Label { Text = "ArtifactRoot:", AutoSize = true, Margin = new Padding(8) });
        _artifactInput.Width = 560;
        artifactPanel.Controls.Add(_artifactInput);
        artifactPanel.Controls.Add(ActionButton("انتخاب پوشه", ChooseArtifactRoot));
        root.Controls.Add(artifactPanel);

        _autostart.Text = "Agent هنگام ورود به Windows به‌صورت خودکار اجرا شود";
        _autostart.AutoSize = true;
        _autostart.Margin = new Padding(8, 16, 8, 8);
        root.Controls.Add(_autostart);

        var warning = new Label
        {
            Text = "تغییر ArtifactRoot فایل‌های قبلی را جابه‌جا نمی‌کند؛ فقط محل جدید برای Artifactهای بعدی آماده می‌شود.",
            AutoSize = true,
            MaximumSize = new Size(850, 0),
            Margin = new Padding(8)
        };
        root.Controls.Add(warning);

        _saveSettings.Text = "ذخیره تنظیمات و راه‌اندازی مجدد Agent";
        _saveSettings.AutoSize = true;
        _saveSettings.Padding = new Padding(14, 8, 14, 8);
        _saveSettings.Margin = new Padding(8, 18, 8, 8);
        _saveSettings.Click += async (_, _) => await SaveSettingsAsync();
        root.Controls.Add(_saveSettings);

        root.Controls.Add(SectionTitle("امنیت"));
        root.Controls.Add(new Label
        {
            Text = "Token اتصال عمداً در این پنل نمایش داده نمی‌شود. دسترسی Agent فقط از طریق Workspace و Permissionهایی که تعریف می‌کنی انجام می‌شود.",
            AutoSize = true,
            MaximumSize = new Size(850, 0),
            Margin = new Padding(8)
        });

        page.Controls.Add(root);
        return page;
    }

    private TabPage BuildWorkspaceTab()
    {
        var page = NewPage("Workspaceها");
        var panel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(16) };

        _workspaces.Dock = DockStyle.Fill;
        _workspaces.View = View.Details;
        _workspaces.FullRowSelect = true;
        _workspaces.MultiSelect = false;
        _workspaces.Columns.Add("نام", 160);
        _workspaces.Columns.Add("مسیر", 430);
        _workspaces.Columns.Add("دسترسی", 120);
        _workspaces.Columns.Add("ابزارها", 200);
        _workspaces.Columns.Add("وضعیت", 100);
        panel.Controls.Add(_workspaces);

        var top = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 58, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(0, 4, 0, 8) };
        top.Controls.Add(ActionButton("افزودن Workspace", AddWorkspaceAsync));
        top.Controls.Add(ActionButton("حذف از Bridge", RemoveWorkspaceAsync));
        top.Controls.Add(ActionButton("تازه‌سازی", async () => await RefreshWorkspacesAsync()));
        top.Controls.Add(ActionButton("بررسی انتخاب‌شده", InspectWorkspaceAsync));
        panel.Controls.Add(top);

        var note = new Label
        {
            Dock = DockStyle.Bottom,
            Height = 54,
            Text = "حذف Workspace از Bridge هیچ فایل یا پوشه‌ای را از کامپیوتر پاک نمی‌کند؛ فقط دسترسی Agent به آن ثبت را حذف می‌کند.",
            AutoEllipsis = true,
            Padding = new Padding(8)
        };
        panel.Controls.Add(note);

        page.Controls.Add(panel);
        return page;
    }

    private TabPage BuildGettingStartedTab()
    {
        var page = NewPage("شروع کار / Getting Started");
        var root = Stack();

        root.Controls.Add(SectionTitle("برای استفاده از SOKNA Bridge این مراحل را انجام بده"));

        root.Controls.Add(Step("۱", "Agent باید Healthy باشد", "در تب Status وضعیت Agent باید سبز باشد. اگر نیست، دکمه «شروع Agent» را بزن."));
        root.Controls.Add(Step("۲", "Extension مرورگر را Load کن", "Chrome یا Edge را باز کن، Developer mode را روشن کن، Load unpacked را بزن و پوشه Extension نصب‌شده را انتخاب کن."));
        root.Controls.Add(Step("۳", "Workspace تعریف کن", "در تب Workspace پوشه‌ای را که ChatGPT اجازه کار روی آن دارد اضافه کن. برای پروژه نرم‌افزاری می‌توانی preset توسعه را انتخاب کنی."));
        root.Controls.Add(Step("۴", "ChatGPT را باز و همان Chat را Connect کن", "در chatgpt.com روی آیکن SOKNA Bridge بزن و Connect this Chat را انتخاب کن. سبز کامل فقط بعد از End-to-End Verify نمایش داده می‌شود."));
        root.Controls.Add(Step("۵", "در صورت خطا Diagnostics را بگیر", "از Popup بخش Advanced Diagnostics یا تب Diagnostics همین برنامه استفاده کن؛ raw خطا را لازم نیست دستی پیدا کنی."));

        var extPath = Path.Combine(_installRoot, "extension");
        _extensionInfo.Text = "مسیر Extension: " + extPath;
        _extensionInfo.AutoSize = true;
        _extensionInfo.MaximumSize = new Size(850, 0);
        _extensionInfo.Margin = new Padding(8, 18, 8, 8);
        root.Controls.Add(_extensionInfo);

        var extButtons = ButtonRow();
        extButtons.Controls.Add(ActionButton("باز کردن پوشه Extension", () => OpenFolder(extPath)));
        extButtons.Controls.Add(ActionButton("کپی مسیر Extension", () => Clipboard.SetText(extPath)));
        extButtons.Controls.Add(ActionButton("Chrome Extensions", () => OpenBrowserExtensions("chrome.exe", "chrome://extensions")));
        extButtons.Controls.Add(ActionButton("Edge Extensions", () => OpenBrowserExtensions("msedge.exe", "edge://extensions")));
        root.Controls.Add(extButtons);

        var chatButtons = ButtonRow();
        chatButtons.Controls.Add(ActionButton("باز کردن ChatGPT", () => OpenUrl("https://chatgpt.com/")));
        root.Controls.Add(chatButtons);

        root.Controls.Add(new Label
        {
            Text = "نکته: خود SOKNA Bridge جای ChatGPT نیست. Control Center وضعیت و دسترسی‌های محلی را مدیریت می‌کند؛ ارتباط گفتگو با Agent از طریق Extension مرورگر و Native Host انجام می‌شود.",
            AutoSize = true,
            MaximumSize = new Size(850, 0),
            Margin = new Padding(8, 20, 8, 8)
        });

        page.Controls.Add(root);
        return page;
    }

    private async Task RefreshAllAsync()
    {
        if (_busy) return;
        _busy = true;
        try
        {
            _lastError.Text = "";
            var cfg = ReadConfig();
            var port = cfg["port"]?.GetValue<int>() ?? 8766;
            var artifact = cfg["artifact_root"]?.GetValue<string>() ?? "";
            _portInput.Value = Math.Clamp(port, (int)_portInput.Minimum, (int)_portInput.Maximum);
            _artifactInput.Text = artifact;
            _autostart.Checked = IsAutostartEnabled();

            _version.Text = ReadProductVersion();
            _port.Text = port.ToString();
            _artifact.Text = artifact;

            try
            {
                var ping = await AgentCallAsync("ping", new { });
                var ok = ping["ok"]?.GetValue<bool>() == true;
                _status.Text = ok ? "● Agent فعال و قابل دسترس است" : "● Agent پاسخ سالم نداد";
                _status.ForeColor = ok ? Color.SeaGreen : Color.Firebrick;
            }
            catch (Exception ex)
            {
                _status.Text = "● Agent در دسترس نیست";
                _status.ForeColor = Color.Firebrick;
                _lastError.Text = ex.Message;
            }

            await RefreshWorkspacesAsync(silent: true);
        }
        finally { _busy = false; }
    }

    private async Task RefreshWorkspacesAsync(bool silent = false)
    {
        try
        {
            var result = await AgentCallAsync("workspace.list", new { });
            _workspaces.Items.Clear();
            var arr = result["workspaces"] as JsonArray;
            if (arr is not null)
            {
                foreach (var node in arr)
                {
                    if (node is not JsonObject w) continue;
                    var scopes = w["scopes"] as JsonArray;
                    var access = scopes is null ? "" : string.Join(", ", scopes.OfType<JsonObject>().Select(s => s["access"]?.GetValue<string>() ?? ""));
                    var tools = w["tools"] as JsonArray;
                    var toolText = tools is null ? "" : string.Join(", ", tools.Select(t => t?.GetValue<string>() ?? ""));
                    var item = new ListViewItem(w["id"]?.GetValue<string>() ?? w["name"]?.GetValue<string>() ?? "");
                    item.SubItems.Add(w["path"]?.GetValue<string>() ?? "");
                    item.SubItems.Add(access);
                    item.SubItems.Add(toolText);
                    item.SubItems.Add("ثبت‌شده");
                    item.Tag = w["id"]?.GetValue<string>() ?? w["name"]?.GetValue<string>() ?? "";
                    _workspaces.Items.Add(item);
                }
            }
            _workspaceCount.Text = _workspaces.Items.Count.ToString();
        }
        catch (Exception ex)
        {
            _workspaceCount.Text = "—";
            if (!silent) ShowError(ex);
        }
    }

    private async Task AddWorkspaceAsync()
    {
        using var dialog = new WorkspaceDialog();
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        try
        {
            var tools = dialog.DevelopmentAccess ? DevelopmentTools : Array.Empty<string>();
            var access = dialog.DevelopmentAccess ? "write" : "read";
            var result = await AgentCallAsync("workspace.register", new
            {
                id = dialog.WorkspaceId,
                display_name = dialog.DisplayNameValue,
                root = dialog.WorkspacePath,
                scopes = new[] { new { path = ".", access } },
                tools
            });
            if (result["ok"]?.GetValue<bool>() != true) throw new InvalidOperationException("ثبت Workspace ناموفق بود.");
            await RefreshWorkspacesAsync();
        }
        catch (Exception ex) { ShowError(ex); }
    }

    private async Task RemoveWorkspaceAsync()
    {
        if (_workspaces.SelectedItems.Count != 1) { MessageBox.Show(this, "یک Workspace را انتخاب کن.", Text); return; }
        var id = _workspaces.SelectedItems[0].Tag?.ToString() ?? "";
        if (MessageBox.Show(this, $"Workspace «{id}» فقط از Bridge حذف شود؟\nفایل‌های روی دیسک دست‌نخورده می‌مانند.", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        try
        {
            await AgentCallAsync("workspace.unregister", new { id });
            await RefreshWorkspacesAsync();
        }
        catch (Exception ex) { ShowError(ex); }
    }

    private async Task InspectWorkspaceAsync()
    {
        if (_workspaces.SelectedItems.Count != 1) { MessageBox.Show(this, "یک Workspace را انتخاب کن.", Text); return; }
        var id = _workspaces.SelectedItems[0].Tag?.ToString() ?? "";
        try
        {
            var r = await AgentCallAsync("workspace.inspect", new { workspace = id });
            _diagnosticsBox.Text = r.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
            _diagnosticsStatus.Text = "جزئیات Workspace «" + id + "» در تب Diagnostics آماده است.";
        }
        catch (Exception ex) { ShowError(ex); }
    }

    private async Task RefreshDiagnosticsAsync()
    {
        var output = Path.Combine(Path.GetTempPath(), "sokna-diagnostics-" + Guid.NewGuid().ToString("N") + ".json");
        try
        {
            await RunMaintenanceAsync("diagnostics", "--output", output);
            _diagnosticsBox.Text = File.Exists(output) ? File.ReadAllText(output, Encoding.UTF8) : "{}";
            _diagnosticsStatus.Text = "Diagnostic در " + DateTime.Now.ToString("HH:mm:ss") + " به‌روز شد.";
        }
        catch (Exception ex)
        {
            await CreateMinimalDiagnosticsAsync(ex);
        }
        finally { try { if (File.Exists(output)) File.Delete(output); } catch { } }
    }

    private async Task CreateMinimalDiagnosticsAsync(Exception? cause = null)
    {
        var minimal = new JsonObject
        {
            ["schema"] = "sokna-control-center-minimal-diagnostics-v1",
            ["generated_at"] = DateTimeOffset.UtcNow.ToString("O"),
            ["install_root"] = _installRoot,
            ["product_version"] = ReadProductVersion(),
            ["config_exists"] = File.Exists(Path.Combine(_installRoot, "config.json")),
            ["manifest_exists"] = File.Exists(Path.Combine(_installRoot, "manifests", "installed-manifest.json")),
            ["logs_exists"] = Directory.Exists(Path.Combine(_installRoot, "logs")),
            ["error"] = cause?.Message ?? _errorDetails.Text
        };
        try { var ping = await AgentCallAsync("ping", new { }); minimal["agent_ping"] = ping.DeepClone(); } catch (Exception ex) { minimal["agent_error"] = ex.Message; }
        _diagnosticsBox.Text = minimal.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
        _diagnosticsStatus.Text = "Minimal Diagnostics آماده است.";
    }

    private async Task SaveDiagnosticsAsync()
    {
        if (string.IsNullOrWhiteSpace(_diagnosticsBox.Text)) await RefreshDiagnosticsAsync();
        using var dlg = new SaveFileDialog { Filter = "JSON (*.json)|*.json", FileName = "SOKNA-Bridge-Diagnostics.json", InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments) };
        if (dlg.ShowDialog(this) == DialogResult.OK) File.WriteAllText(dlg.FileName, _diagnosticsBox.Text, new UTF8Encoding(false));
    }

    private async Task RetryLastMaintenanceAsync()
    {
        if (string.IsNullOrWhiteSpace(_lastMaintenanceAction)) { await RefreshAllAsync(); return; }
        try { await RunMaintenanceAsync(_lastMaintenanceAction, _lastMaintenanceArgs); _errorPanel.Visible = false; await RefreshAllAsync(); }
        catch (Exception ex) { ShowError(ex); }
    }

    private async Task LifecycleAsync(string action)
    {
        try
        {
            if (action == "start") await RunMaintenanceAsync("start", "--expected-version", ReadProductVersion());
            else await RunMaintenanceAsync(action);
            await RefreshAllAsync();
        }
        catch (Exception ex) { ShowError(ex); }
    }

    private async Task SaveSettingsAsync()
    {
        try
        {
            _saveSettings.Enabled = false;
            var artifact = Path.GetFullPath(_artifactInput.Text.Trim());
            await RunMaintenanceAsync("settings-apply",
                "--port", ((int)_portInput.Value).ToString(),
                "--artifact-root", artifact,
                "--autostart", _autostart.Checked ? "true" : "false");
            await RefreshAllAsync();
            MessageBox.Show(this, "تنظیمات ذخیره شد و Agent با تنظیمات جدید بررسی شد.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception ex) { ShowError(ex); }
        finally { _saveSettings.Enabled = true; }
    }

    private void ChooseArtifactRoot()
    {
        using var dlg = new FolderBrowserDialog { Description = "ArtifactRoot جدید را انتخاب کن", UseDescriptionForTitle = true };
        if (Directory.Exists(_artifactInput.Text)) dlg.InitialDirectory = _artifactInput.Text;
        if (dlg.ShowDialog(this) == DialogResult.OK) _artifactInput.Text = dlg.SelectedPath;
    }

    private async Task CreateSupportBundleAsync()
    {
        using var dlg = new SaveFileDialog
        {
            Filter = "ZIP file (*.zip)|*.zip",
            FileName = "SOKNA-Bridge-Support.zip",
            InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments)
        };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        try
        {
            var op = await RunMaintenanceAsync("support-bundle", "--output", dlg.FileName);
            var data = op?["data"] as JsonObject;
            var partial = data?["partial"]?.GetValue<bool>() == true;
            var count = data?["error_count"]?.GetValue<int>() ?? 0;
            MessageBox.Show(this, partial ? $"Support Bundle ساخته شد، اما {count} فایل قابل خواندن نبود و در bundle-errors.json ثبت شد.\n{dlg.FileName}" : "Support Bundle کامل ساخته شد:\n" + dlg.FileName, Text, MessageBoxButtons.OK, partial ? MessageBoxIcon.Warning : MessageBoxIcon.Information);
        }
        catch (Exception ex) { ShowError(ex); }
    }

    private JsonObject ReadConfig()
    {
        var path = Path.Combine(_installRoot, "config.json");
        return JsonNode.Parse(File.ReadAllText(path, Encoding.UTF8))?.AsObject()
               ?? throw new InvalidDataException("config.json معتبر نیست.");
    }

    private string CurrentArtifactRoot()
    {
        try { return ReadConfig()["artifact_root"]?.GetValue<string>() ?? ""; }
        catch { return ""; }
    }

    private string ReadProductVersion()
    {
        try
        {
            var path = Path.Combine(_installRoot, "manifests", "installed-manifest.json");
            var obj = JsonNode.Parse(File.ReadAllText(path, Encoding.UTF8))?.AsObject();
            return obj?["product_version"]?.GetValue<string>() ?? "unknown";
        }
        catch { return "unknown"; }
    }

    private bool IsAutostartEnabled()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run");
            var value = key?.GetValue("SOKNA Agent")?.ToString();
            return !string.IsNullOrWhiteSpace(value) && value.Contains("Sokna.Agent.Launcher.exe", StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    private async Task<JsonObject> AgentCallAsync(string action, object parameters)
    {
        var cfg = ReadConfig();
        var port = cfg["port"]?.GetValue<int>() ?? throw new InvalidDataException("پورت Agent در config وجود ندارد.");
        var token = cfg["token"]?.GetValue<string>() ?? throw new InvalidDataException("Token Agent در config وجود ندارد.");
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        http.DefaultRequestHeaders.Add("X-Sokna-Token", token);
        var body = new { id = "control-" + Guid.NewGuid().ToString("N"), action, @params = parameters };
        using var response = await http.PostAsJsonAsync($"http://127.0.0.1:{port}/api", body);
        var raw = await response.Content.ReadAsStringAsync();
        var obj = JsonNode.Parse(raw)?.AsObject() ?? throw new InvalidDataException("پاسخ Agent معتبر نیست.");
        if (!response.IsSuccessStatusCode || obj["ok"]?.GetValue<bool>() != true)
            throw new InvalidOperationException(obj["error"]?.GetValue<string>() ?? $"Agent HTTP {(int)response.StatusCode}");
        return obj;
    }

    private async Task<JsonObject?> RunMaintenanceAsync(string action, params string[] args)
    {
        _lastMaintenanceAction = action; _lastMaintenanceArgs = args.ToArray();
        var exe = Path.Combine(_installRoot, "Sokna.Agent.Maintenance.exe");
        if (!File.Exists(exe)) throw new FileNotFoundException("Maintenance executable پیدا نشد.", exe);
        var psi = new ProcessStartInfo(exe) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = _installRoot };
        psi.ArgumentList.Add(action); psi.ArgumentList.Add("--install-root"); psi.ArgumentList.Add(_installRoot); foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi) ?? throw new InvalidOperationException("Maintenance اجرا نشد.");
        var stdout = p.StandardOutput.ReadToEndAsync(); var stderr = p.StandardError.ReadToEndAsync(); await p.WaitForExitAsync(); var o = await stdout; var e = await stderr;
        if (p.ExitCode != 0) throw new InvalidOperationException(string.IsNullOrWhiteSpace(e) ? o : e);
        try { return JsonNode.Parse(o)?.AsObject(); } catch { return null; }
    }

    private static void OpenFolder(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        Directory.CreateDirectory(path);
        var psi = new ProcessStartInfo("explorer.exe") { UseShellExecute = true };
        psi.ArgumentList.Add(path);
        Process.Start(psi);
    }

    private static void OpenUrl(string url) => Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });

    private void OpenBrowserExtensions(string exe, string url)
    {
        try { Process.Start(new ProcessStartInfo(exe, url) { UseShellExecute = true }); }
        catch { MessageBox.Show(this, $"مرورگر پیدا نشد. این آدرس را داخل مرورگر باز کن:\n{url}", Text, MessageBoxButtons.OK, MessageBoxIcon.Information); }
    }

    private void ShowError(Exception ex)
    {
        var raw = ex.Message;
        var summary = "عملیات انجام نشد. جزئیات فنی در پنل خطا ثبت شده است.";
        try
        {
            var obj = JsonNode.Parse(raw)?.AsObject();
            var action = obj?["action"]?.GetValue<string>() ?? "";
            var error = obj?["error"]?.GetValue<string>() ?? "";
            var session = obj?["session_id"]?.GetValue<string>() ?? "";
            if (!string.IsNullOrWhiteSpace(error)) summary = (string.IsNullOrWhiteSpace(action) ? "عملیات" : action) + ": " + error;
            if (!string.IsNullOrWhiteSpace(session)) summary += "\nError/Session ID: " + session;
        }
        catch
        {
            var first = raw.Replace("\r", "").Split('\n').FirstOrDefault(x => !string.IsNullOrWhiteSpace(x))?.Trim();
            if (!string.IsNullOrWhiteSpace(first)) summary = first.Length > 240 ? first[..240] + "…" : first;
        }
        _lastError.Text = summary; _errorDetails.Text = raw; _errorPanel.Visible = true;
        MessageBox.Show(this, summary, "SOKNA Bridge — عملیات ناموفق", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    private static TabPage NewPage(string title) => new(title) { Padding = new Padding(8) };

    private static FlowLayoutPanel Stack() => new()
    {
        Dock = DockStyle.Fill,
        AutoScroll = true,
        FlowDirection = FlowDirection.TopDown,
        WrapContents = false,
        Padding = new Padding(18)
    };

    private static FlowLayoutPanel ButtonRow() => new()
    {
        AutoSize = true,
        FlowDirection = FlowDirection.RightToLeft,
        WrapContents = true,
        Margin = new Padding(8)
    };

    private Button ActionButton(string text, Action action)
    {
        var b = new Button { Text = text, AutoSize = true, Padding = new Padding(10, 5, 10, 5), Margin = new Padding(5) };
        b.Click += (_, _) => { try { action(); } catch (Exception ex) { ShowError(ex); } };
        return b;
    }

    private Button ActionButton(string text, Func<Task> action)
    {
        var b = new Button { Text = text, AutoSize = true, Padding = new Padding(10, 5, 10, 5), Margin = new Padding(5) };
        b.Click += async (_, _) =>
        {
            b.Enabled = false;
            try { await action(); } catch (Exception ex) { ShowError(ex); }
            finally { b.Enabled = true; }
        };
        return b;
    }

    private static Control InfoRow(string name, Label value)
    {
        var row = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.RightToLeft, WrapContents = false, Margin = new Padding(8, 4, 8, 4) };
        row.Controls.Add(new Label { Text = name + ":", AutoSize = true, Font = new Font("Segoe UI", 10f, FontStyle.Bold), Margin = new Padding(5) });
        value.Text = "—";
        value.AutoSize = true;
        value.MaximumSize = new Size(720, 0);
        value.Margin = new Padding(5);
        row.Controls.Add(value);
        return row;
    }

    private static Label SectionTitle(string text) => new()
    {
        Text = text,
        AutoSize = true,
        Font = new Font("Segoe UI", 15f, FontStyle.Bold),
        Margin = new Padding(8, 22, 8, 10)
    };

    private static FlowLayoutPanel Card(string title)
    {
        var g = new FlowLayoutPanel { AutoSize = true, Width = 900, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(12), Margin = new Padding(8), BorderStyle = BorderStyle.FixedSingle, RightToLeft = RightToLeft.Yes };
        g.Controls.Add(new Label { Text = title, AutoSize = true, Font = new Font("Tahoma", 12f, FontStyle.Bold), Margin = new Padding(8, 4, 8, 8) });
        return g;
    }

    private static void AddInfo(TableLayoutPanel table, int row, string name, Label value)
    {
        while (table.RowCount <= row) { table.RowStyles.Add(new RowStyle(SizeType.AutoSize)); table.RowCount++; }
        table.Controls.Add(new Label { Text = name, AutoSize = true, Font = new Font("Tahoma", 9.5f, FontStyle.Bold), Margin = new Padding(6) }, 0, row);
        value.Text = "—"; value.AutoSize = true; value.MaximumSize = new Size(620, 0); value.Margin = new Padding(6);
        table.Controls.Add(value, 1, row);
    }

    private Button StyledButton(string text, Action action, string style) => Style(ActionButton(text, action), style);
    private Button StyledButton(string text, Func<Task> action, string style) => Style(ActionButton(text, action), style);
    private static Button Style(Button b, string style)
    {
        b.FlatStyle = FlatStyle.Flat; b.FlatAppearance.BorderSize = 1;
        if (style == "primary") { b.BackColor = Color.FromArgb(34, 103, 209); b.ForeColor = Color.White; b.FlatAppearance.BorderColor = b.BackColor; }
        else if (style == "danger") { b.ForeColor = Color.Firebrick; b.FlatAppearance.BorderColor = Color.FromArgb(220, 150, 145); }
        else { b.BackColor = Color.White; b.FlatAppearance.BorderColor = Color.FromArgb(205, 210, 218); }
        return b;
    }

    private static Control Step(string number, string title, string detail)
    {
        var table = new TableLayoutPanel { Width = 880, AutoSize = true, ColumnCount = 2, RightToLeft = RightToLeft.Yes, Margin = new Padding(8), Padding = new Padding(10), BorderStyle = BorderStyle.FixedSingle };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 64)); table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        var n = new Label { Text = number, AutoSize = false, Width = 42, Height = 42, TextAlign = ContentAlignment.MiddleCenter, Font = new Font("Tahoma", 13f, FontStyle.Bold), BorderStyle = BorderStyle.FixedSingle, Margin = new Padding(6) };
        var text = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Margin = new Padding(6) };
        text.Controls.Add(new Label { Text = title, AutoSize = true, Font = new Font("Tahoma", 10.5f, FontStyle.Bold) });
        text.Controls.Add(new Label { Text = detail, AutoSize = true, MaximumSize = new Size(750, 0), ForeColor = Color.DimGray, Margin = new Padding(0, 6, 0, 0) });
        table.Controls.Add(n, 0, 0); table.Controls.Add(text, 1, 0); return table;
    }}
