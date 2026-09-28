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
        Font = new Font("Segoe UI", 10f);
        RightToLeft = RightToLeft.Yes;
        RightToLeftLayout = true;

        var tabs = new TabControl { Dock = DockStyle.Fill };
        tabs.TabPages.Add(BuildHomeTab());
        tabs.TabPages.Add(BuildSettingsTab());
        tabs.TabPages.Add(BuildWorkspaceTab());
        tabs.TabPages.Add(BuildGettingStartedTab());
        Controls.Add(tabs);

        Shown += async (_, _) => await RefreshAllAsync();
    }

    private TabPage BuildHomeTab()
    {
        var page = NewPage("وضعیت / Status");
        var root = Stack();

        var title = new Label
        {
            Text = "SOKNA Bridge",
            AutoSize = true,
            Font = new Font(Font.FontFamily, 22f, FontStyle.Bold),
            Margin = new Padding(8, 18, 8, 4)
        };
        root.Controls.Add(title);

        _status.AutoSize = true;
        _status.Font = new Font(Font.FontFamily, 14f, FontStyle.Bold);
        _status.Text = "در حال بررسی وضعیت Agent…";
        _status.Margin = new Padding(8, 8, 8, 16);
        root.Controls.Add(_status);

        root.Controls.Add(InfoRow("نسخه / Version", _version));
        root.Controls.Add(InfoRow("پورت / Port", _port));
        root.Controls.Add(InfoRow("ArtifactRoot", _artifact));
        root.Controls.Add(InfoRow("Workspaceها", _workspaceCount));

        var buttons = ButtonRow();
        buttons.Controls.Add(ActionButton("تازه‌سازی", async () => await RefreshAllAsync()));
        buttons.Controls.Add(ActionButton("شروع Agent", async () => await LifecycleAsync("start")));
        buttons.Controls.Add(ActionButton("توقف Agent", async () => await LifecycleAsync("stop")));
        buttons.Controls.Add(ActionButton("راه‌اندازی مجدد", async () =>
        {
            await RunMaintenanceAsync("stop");
            await RunMaintenanceAsync("start", "--expected-version", ReadProductVersion());
            await RefreshAllAsync();
        }));
        root.Controls.Add(buttons);

        var folders = ButtonRow();
        folders.Controls.Add(ActionButton("باز کردن ArtifactRoot", () => OpenFolder(CurrentArtifactRoot())));
        folders.Controls.Add(ActionButton("باز کردن Logها", () => OpenFolder(Path.Combine(_installRoot, "logs"))));
        folders.Controls.Add(ActionButton("ساخت Support Bundle", CreateSupportBundleAsync));
        root.Controls.Add(folders);

        _lastError.AutoSize = true;
        _lastError.MaximumSize = new Size(900, 0);
        _lastError.ForeColor = Color.Firebrick;
        _lastError.Margin = new Padding(8, 18, 8, 8);
        root.Controls.Add(_lastError);

        page.Controls.Add(root);
        return page;
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
        _workspaces.Columns.Add("ابزارها", 220);
        panel.Controls.Add(_workspaces);

        var top = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 58, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(0, 4, 0, 8) };
        top.Controls.Add(ActionButton("افزودن Workspace", AddWorkspaceAsync));
        top.Controls.Add(ActionButton("حذف از Bridge", RemoveWorkspaceAsync));
        top.Controls.Add(ActionButton("تازه‌سازی", async () => await RefreshWorkspacesAsync()));
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
        root.Controls.Add(Step("۴", "ChatGPT را باز کن", "بعد از فعال‌شدن Extension، chatgpt.com را باز یا Refresh کن و کار را در همان گفتگو درخواست کن."));

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
            await RunMaintenanceAsync("support-bundle", "--output", dlg.FileName);
            MessageBox.Show(this, "Support Bundle ساخته شد:\n" + dlg.FileName, Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
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

    private async Task RunMaintenanceAsync(string action, params string[] args)
    {
        var exe = Path.Combine(_installRoot, "Sokna.Agent.Maintenance.exe");
        if (!File.Exists(exe)) throw new FileNotFoundException("Maintenance executable پیدا نشد.", exe);
        var psi = new ProcessStartInfo(exe) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = _installRoot };
        psi.ArgumentList.Add(action);
        psi.ArgumentList.Add("--install-root");
        psi.ArgumentList.Add(_installRoot);
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi) ?? throw new InvalidOperationException("Maintenance اجرا نشد.");
        var stdout = p.StandardOutput.ReadToEndAsync();
        var stderr = p.StandardError.ReadToEndAsync();
        await p.WaitForExitAsync();
        var o = await stdout;
        var e = await stderr;
        if (p.ExitCode != 0)
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(e) ? o : e);
    }

    private static void OpenFolder(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        Directory.CreateDirectory(path);
        Process.Start(new ProcessStartInfo("explorer.exe", $""{path}"") { UseShellExecute = true });
    }

    private static void OpenUrl(string url) => Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });

    private void OpenBrowserExtensions(string exe, string url)
    {
        try { Process.Start(new ProcessStartInfo(exe, url) { UseShellExecute = true }); }
        catch { MessageBox.Show(this, $"مرورگر پیدا نشد. این آدرس را داخل مرورگر باز کن:\n{url}", Text, MessageBoxButtons.OK, MessageBoxIcon.Information); }
    }

    private void ShowError(Exception ex)
    {
        _lastError.Text = ex.Message;
        MessageBox.Show(this, ex.Message, "SOKNA Bridge", MessageBoxButtons.OK, MessageBoxIcon.Error);
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

    private static Control Step(string number, string title, string detail)
    {
        var p = new Panel { Width = 880, Height = 82, Margin = new Padding(8) };
        var n = new Label { Text = number, AutoSize = false, TextAlign = ContentAlignment.MiddleCenter, Width = 45, Height = 45, Left = 815, Top = 10, Font = new Font("Segoe UI", 14f, FontStyle.Bold), BorderStyle = BorderStyle.FixedSingle };
        var t = new Label { Text = title, AutoSize = true, Left = 20, Top = 8, Font = new Font("Segoe UI", 11f, FontStyle.Bold) };
        var d = new Label { Text = detail, AutoSize = false, Left = 20, Top = 34, Width = 770, Height = 42 };
        p.Controls.Add(n); p.Controls.Add(t); p.Controls.Add(d);
        return p;
    }
}
