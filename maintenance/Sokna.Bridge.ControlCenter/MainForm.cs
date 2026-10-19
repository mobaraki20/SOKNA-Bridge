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
    private readonly Label _shellVersion = new();
    private readonly Label _statusGuidance = new();
    private readonly Label _port = new();
    private readonly Label _artifact = new();
    private readonly Label _workspaceCount = new();
    private readonly Label _lastError = new();
    private readonly TextBox _errorDetails = new();
    private readonly Panel _errorPanel = new();
    private readonly TextBox _diagnosticsBox = new();
    private readonly Label _diagnosticsStatus = new();
    private readonly Label _diagnosticsEmpty = new();
    private string _lastMaintenanceAction = "";
    private string[] _lastMaintenanceArgs = Array.Empty<string>();
    private readonly NumericUpDown _portInput = new();
    private readonly TextBox _artifactInput = new();
    private readonly CheckBox _autostart = new();
    private readonly ListView _workspaces = new();
    private readonly Label _workspacesEmpty = new();
    private readonly ListView _credentials = new();
    private readonly Label _credentialsEmpty = new();
    private readonly Label _extensionInfo = new();
    private readonly Button _saveSettings = new();
    private bool _busy;

    private static readonly string[] DevelopmentTools =
    [
        "git","git.exe","gh","gh.exe","dotnet","dotnet.exe","python","python.exe","py","py.exe",
        "node","node.exe","npm","npm.cmd","npx","npx.cmd","powershell","powershell.exe",
        "pwsh","pwsh.exe","cmd","cmd.exe","php","php.exe","composer","composer.bat","browser"
    ];

    internal MainForm(bool layoutTestMode = false)
    {
        Text = "مرکز کنترل بریج سکنا — SOKNA Bridge";
        ClientSize = new Size(1100, 720);
        MinimumSize = new Size(840, 560);
        StartPosition = FormStartPosition.CenterScreen;
        BridgeUi.Prepare(this);

        var tabs = new TabControl { Dock = DockStyle.Fill, RightToLeft = RightToLeft.Yes, RightToLeftLayout = true, Padding = new Point(17, 8), Font = BridgeUi.Font(10.7f, FontStyle.Bold) };
        tabs.TabPages.Add(BuildHomeTab());
        tabs.TabPages.Add(BuildWorkspaceTab());
        tabs.TabPages.Add(BuildCredentialsTab());
        tabs.TabPages.Add(BuildSettingsTab());
        tabs.TabPages.Add(BuildDiagnosticsTab());
        tabs.TabPages.Add(BuildGettingStartedTab());
        Controls.Add(tabs);
        BridgeUi.Fields(tabs);
        if (!layoutTestMode) Shown += async (_, _) => await RefreshAllAsync();
    }

    private TabPage BuildHomeTab()
    {
        var page = NewPage("وضعیت");
        var root = Stack();

        root.Controls.Add(new Label { Text = "مرکز کنترل بریج سکنا", AutoSize = true, Font = BridgeUi.Font(19f, FontStyle.Bold), ForeColor = BridgeUi.BrandDark, Margin = new Padding(8, 12, 8, 3) });
        root.Controls.Add(new Label { Text = "وضعیت Agent، مدیریت دسترسی‌ها و پشتیبانی — SOKNA Bridge", AutoSize = true, Font = BridgeUi.Font(10.6f), ForeColor = BridgeUi.Muted, Margin = new Padding(8, 0, 8, 16) });

        var health = Card("وضعیت Agent و اطلاعات نصب");
        health.Name = "BridgeAgentHealthCard";
        _status.AutoSize = true; _status.Font = BridgeUi.Font(14f, FontStyle.Bold); _status.Text = "در حال بررسی…"; _status.Margin = new Padding(8, 8, 8, 12);
        health.Controls.Add(_status);
        _statusGuidance.Text = "آخرین وضعیت هنوز بررسی نشده است. برای بررسی «تازه‌سازی» را بزن.";
        _statusGuidance.ForeColor = BridgeUi.Muted;
        _statusGuidance.AutoSize = true;
        _statusGuidance.Margin = new Padding(8, 0, 8, 8);
        health.Controls.Add(_statusGuidance);
        var info = new TableLayoutPanel { Name = "BridgeStatusFacts", AutoSize = true, ColumnCount = 2, RightToLeft = RightToLeft.Yes, Padding = new Padding(8), Margin = new Padding(8), Width = 760, BackColor = BridgeUi.Surface };
        info.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 240)); info.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        AddInfo(info, 0, "نسخه کنترل‌پنل", _shellVersion);
        AddInfo(info, 1, "نسخه Agent نصب‌شده", _version);
        AddInfo(info, 2, "پورت محلی", _port);
        AddInfo(info, 3, "محل فایل‌ها", _artifact);
        _artifact.RightToLeft = RightToLeft.No;
        AddInfo(info, 4, "تعداد فضای کاری", _workspaceCount);
        health.Controls.Add(info);
        root.Controls.Add(health);

        var primary = Card("مدیریت Agent");
        var actions = ButtonRow();
        actions.Controls.Add(StyledButton("تازه‌سازی وضعیت", async () => await RefreshAllAsync(), "primary"));
        actions.Controls.Add(StyledButton("شروع Agent", async () => await LifecycleAsync("start"), "secondary"));
        actions.Controls.Add(StyledButton("راه‌اندازی مجدد", async () => {
            if (MessageBox.Show(this, "Agent متوقف و دوباره راه‌اندازی شود؟", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            await RunMaintenanceAsync("stop");
            await RunMaintenanceAsync("start", "--expected-version", ReadProductVersion());
            await RefreshAllAsync();
        }, "secondary"));
        actions.Controls.Add(StyledButton("توقف Agent", async () => await LifecycleAsync("stop"), "danger"));
        primary.Controls.Add(actions);
        root.Controls.Add(primary);

        var maintenance = Card("عیب‌یابی و پشتیبانی");
        var tools = ButtonRow();
        tools.Controls.Add(StyledButton("باز کردن Logها", () => OpenFolder(Path.Combine(_installRoot, "logs")), "secondary"));
        tools.Controls.Add(StyledButton("باز کردن ArtifactRoot", () => OpenFolder(CurrentArtifactRoot()), "secondary"));
        tools.Controls.Add(StyledButton("ساخت بسته پشتیبانی", CreateSupportBundleAsync, "secondary"));
        tools.Controls.Add(StyledButton("عیب‌یابی", async () => {
            await RefreshDiagnosticsAsync();
            if (Controls.OfType<TabControl>().FirstOrDefault() is { } tabs)
                tabs.SelectedTab = tabs.TabPages.Cast<TabPage>().FirstOrDefault(p => p.Text == "عیب‌یابی");
        }, "primary"));
        maintenance.Controls.Add(tools);
        root.Controls.Add(maintenance);

        _errorPanel.AutoSize = false;
        _errorPanel.Height = 285;
        _errorPanel.Padding = new Padding(10);
        _errorPanel.Margin = new Padding(8);
        _errorPanel.BackColor = BridgeUi.DangerSoft;
        _errorPanel.BorderStyle = BorderStyle.FixedSingle;
        _errorPanel.Visible = false;
        var errorTable = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1,
            RowCount = 4, BackColor = BridgeUi.DangerSoft };
        errorTable.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        errorTable.RowStyles.Add(new RowStyle(SizeType.Absolute, 55));
        errorTable.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        errorTable.RowStyles.Add(new RowStyle(SizeType.Absolute, 64));
        var errorTitle = new Label { Text = "آخرین عملیات کامل نشد",
            Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleRight,
            Font = BridgeUi.Font(11f, FontStyle.Bold), ForeColor = BridgeUi.Danger };
        _lastError.AutoSize = false;
        _lastError.Dock = DockStyle.Fill;
        _lastError.TextAlign = ContentAlignment.MiddleRight;
        _lastError.ForeColor = BridgeUi.Danger;
        _errorDetails.Multiline = true; _errorDetails.ReadOnly = true;
        _errorDetails.Dock = DockStyle.Fill; _errorDetails.ScrollBars = ScrollBars.Vertical;
        _errorDetails.RightToLeft = RightToLeft.No;
        _errorDetails.Font = new Font("Consolas", 9f);
        var errButtons = ButtonRow();
        errButtons.Controls.Add(StyledButton("کپی جزئیات", () => Clipboard.SetText(_errorDetails.Text), "secondary"));
        errButtons.Controls.Add(StyledButton("باز کردن گزارش‌ها", () => OpenFolder(Path.Combine(_installRoot, "logs", "maintenance")), "secondary"));
        errButtons.Controls.Add(StyledButton("عیب‌یابی مختصر", async () => await CreateMinimalDiagnosticsAsync(), "secondary"));
        errButtons.Controls.Add(StyledButton("تلاش دوباره", RetryLastMaintenanceAsync, "primary"));
        errorTable.Controls.Add(errorTitle, 0, 0);
        errorTable.Controls.Add(_lastError, 0, 1);
        errorTable.Controls.Add(_errorDetails, 0, 2);
        errorTable.Controls.Add(errButtons, 0, 3);
        _errorPanel.Controls.Add(errorTable);
        root.Controls.Add(_errorPanel);

        page.Controls.Add(root);
        return page;
    }

    private TabPage BuildDiagnosticsTab()
    {
        var page = NewPage("عیب‌یابی");
        var root = Stack();
        root.Controls.Add(SectionTitle("عیب‌یابی و گزارش پشتیبانی"));
        root.Controls.Add(new Label { Text = "ابتدا وضعیت بررسی را بخوان. فقط هنگام نیاز، گزارش فنی را برای پشتیبانی ذخیره کن. رمزها و Token نباید در خروجی ظاهر شوند.", AutoSize = true, Font = BridgeUi.Font(10.5f), ForeColor = BridgeUi.Muted, Margin = new Padding(8) });
        var actions = ButtonRow();
        actions.Controls.Add(StyledButton("تازه‌سازی عیب‌یابی", RefreshDiagnosticsAsync, "primary"));
        actions.Controls.Add(StyledButton("کپی برای پشتیبانی", () => { if (!string.IsNullOrWhiteSpace(_diagnosticsBox.Text)) Clipboard.SetText(_diagnosticsBox.Text); }, "secondary"));
        actions.Controls.Add(StyledButton("ذخیره JSON", SaveDiagnosticsAsync, "secondary"));
        actions.Controls.Add(StyledButton("بسته پشتیبانی", CreateSupportBundleAsync, "secondary"));
        actions.Controls.Add(StyledButton("گزارش‌ها", () => OpenFolder(Path.Combine(_installRoot, "logs")), "secondary"));
        root.Controls.Add(actions);
        _diagnosticsStatus.AutoSize = true; _diagnosticsStatus.Text = "هنوز عیب‌یابی انجام نشده است."; _diagnosticsStatus.ForeColor = BridgeUi.Muted; _diagnosticsStatus.Margin = new Padding(8); root.Controls.Add(_diagnosticsStatus);
        _diagnosticsBox.Multiline = true; _diagnosticsBox.ReadOnly = true; _diagnosticsBox.ScrollBars = ScrollBars.Both; _diagnosticsBox.WordWrap = false; _diagnosticsBox.RightToLeft = RightToLeft.No; _diagnosticsBox.Font = new Font("Consolas", 9f); _diagnosticsBox.Width = 720; _diagnosticsBox.Height = 335; _diagnosticsBox.Margin = new Padding(8);
        var diagHost = new Panel { Name = "DiagnosticsContent", Dock = DockStyle.Top, Height = 335, BackColor = BridgeUi.Surface, BorderStyle = BorderStyle.FixedSingle, Margin = new Padding(8) };
        _diagnosticsBox.Dock = DockStyle.Fill;
        _diagnosticsBox.Visible = false;
        _diagnosticsBox.Margin = Padding.Empty;
        diagHost.Controls.Add(_diagnosticsBox);
        _diagnosticsEmpty.Dock = DockStyle.Fill;
        _diagnosticsEmpty.TextAlign = ContentAlignment.MiddleCenter;
        _diagnosticsEmpty.ForeColor = BridgeUi.Muted;
        _diagnosticsEmpty.Font = BridgeUi.Font(11.5f);
        _diagnosticsEmpty.Text = "هنوز گزارشی ثبت نشده است.\nبرای بررسی وضعیت، «تازه‌سازی عیب‌یابی» را بزن.";
        _diagnosticsEmpty.BackColor = BridgeUi.Surface;
        diagHost.Controls.Add(_diagnosticsEmpty);
        _diagnosticsEmpty.BringToFront();
        root.Controls.Add(diagHost);
        page.Controls.Add(root); return page;
    }

    private TabPage BuildSettingsTab()
    {
        var page = NewPage("تنظیمات");
        var root = Stack();
        root.Controls.Add(SectionTitle("تنظیمات Agent"));

        var settingsCard = Card("اتصال و مسیر ذخیره‌سازی");
        settingsCard.Controls.Add(BridgeUi.Caption(
            "این تنظیمات فقط روی Agent همین رایانه اثر می‌گذارند."));

        var portArea = new FlowLayoutPanel
        {
            Dock = DockStyle.Top, AutoSize = true,
            FlowDirection = FlowDirection.RightToLeft,
            RightToLeft = RightToLeft.No,
            WrapContents = false, Margin = new Padding(5, 7, 5, 10)
        };
        portArea.Controls.Add(BridgeUi.FieldLabel("پورت محلی Agent"));
        _portInput.Minimum = 1024;
        _portInput.Maximum = 65535;
        _portInput.Value = 8766;
        _portInput.Width = 126;
        _portInput.RightToLeft = RightToLeft.No;
        portArea.Controls.Add(_portInput);
        settingsCard.Controls.Add(portArea);

        settingsCard.Controls.Add(BridgeUi.FieldLabel("محل نگهداری فایل‌ها (ArtifactRoot)"));
        var artifactArea = new TableLayoutPanel
        {
            Dock = DockStyle.Top, Height = 48, ColumnCount = 2,
            RightToLeft = RightToLeft.Yes, BackColor = BridgeUi.Surface,
            Margin = new Padding(5, 0, 5, 10)
        };
        artifactArea.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        artifactArea.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 150));
        _artifactInput.Dock = DockStyle.Top;
        _artifactInput.Height = 34;
        _artifactInput.RightToLeft = RightToLeft.No;
        _artifactInput.TextAlign = HorizontalAlignment.Left;
        artifactArea.Controls.Add(_artifactInput, 0, 0);
        var browse = ActionButton("انتخاب پوشه", ChooseArtifactRoot);
        browse.Dock = DockStyle.Fill;
        artifactArea.Controls.Add(browse, 1, 0);
        settingsCard.Controls.Add(artifactArea);

        _autostart.Text = "اجرای خودکار Agent هنگام ورود به ویندوز";
        _autostart.AutoSize = true;
        _autostart.Font = BridgeUi.Font(10.5f);
        _autostart.Margin = new Padding(7, 12, 7, 8);
        settingsCard.Controls.Add(_autostart);

        settingsCard.Controls.Add(BridgeUi.Caption(
            "تغییر محل ذخیره‌سازی، فایل‌های قبلی را جابه‌جا نمی‌کند. داده‌های بعدی در مسیر جدید ذخیره می‌شوند."));

        _saveSettings.Text = "ذخیره و راه‌اندازی مجدد Agent";
        BridgeUi.Button(_saveSettings, "primary");
        _saveSettings.Click += async (_, _) => await SaveSettingsAsync();
        var saveArea = ButtonRow();
        saveArea.Controls.Add(_saveSettings);
        settingsCard.Controls.Add(saveArea);
        root.Controls.Add(settingsCard);

        var securityCard = Card("حفاظت از اطلاعات");
        securityCard.Controls.Add(BridgeUi.Caption(
            "رمز اتصال و اطلاعات محرمانه در این پنل نمایش داده نمی‌شوند. " +
            "دسترسی Agent فقط از طریق فضاهای کاری و مجوزهایی است که مشخص می‌کنی."));
        root.Controls.Add(securityCard);

        page.Controls.Add(root);
        return page;
    }

    private TabPage BuildWorkspaceTab()
    {
        var page = NewPage("فضاهای کاری");
        var panel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(16), BackColor = BridgeUi.Surface };

        _workspaces.Dock = DockStyle.Fill;
        _workspaces.Visible = false; // The empty-state label owns the surface until real rows arrive.
        _workspaces.View = View.Details;
        _workspaces.FullRowSelect = true;
        _workspaces.MultiSelect = false;
        _workspaces.Columns.Add("نام", 150);
        _workspaces.Columns.Add("مسیر", 330);
        _workspaces.Columns.Add("دسترسی", 135);
        _workspaces.Columns.Add("ابزارها", 140);
        _workspaces.Columns.Add("وضعیت", 90);
        var workspaceList = new Panel { Dock = DockStyle.Fill, BackColor = BridgeUi.Surface };
        workspaceList.Controls.Add(_workspaces);
        _workspacesEmpty.Dock = DockStyle.Fill;
        _workspacesEmpty.BackColor = BridgeUi.Surface;
        _workspacesEmpty.ForeColor = BridgeUi.Muted;
        _workspacesEmpty.Font = BridgeUi.Font(11.5f);
        _workspacesEmpty.TextAlign = ContentAlignment.MiddleCenter;
        _workspacesEmpty.Text = "هنوز فضای کاری ثبت نشده است.\nبرای شروع، «افزودن فضای کاری» را انتخاب کن.";
        workspaceList.Controls.Add(_workspacesEmpty);
        _workspacesEmpty.BringToFront();
        panel.Controls.Add(workspaceList);

        var top = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, FlowDirection = FlowDirection.RightToLeft, WrapContents = true, Padding = new Padding(0, 4, 0, 8) };
        top.Controls.Add(ActionButton("افزودن فضای کاری", AddWorkspaceAsync));
        top.Controls.Add(ActionButton("حذف دسترسی", RemoveWorkspaceAsync));
        top.Controls.Add(ActionButton("تازه‌سازی", async () => await RefreshWorkspacesAsync()));
        top.Controls.Add(ActionButton("بررسی انتخاب‌شده", InspectWorkspaceAsync));
        panel.Controls.Add(top);

        var note = new Label
        {
            Dock = DockStyle.Bottom,
            Height = 54,
            Text = "حذف دسترسی یک فضای کاری، هیچ فایل یا پوشه‌ای را از رایانه پاک نمی‌کند.",
            AutoEllipsis = true,
            ForeColor = BridgeUi.Muted,
            Font = BridgeUi.Font(10.2f),
            Padding = new Padding(8)
        };
        panel.Controls.Add(note);

        page.Controls.Add(panel);
        return page;
    }

    private TabPage BuildCredentialsTab()
    {
        var page = NewPage("اعتبارنامه‌ها");
        var panel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(16), BackColor = BridgeUi.Surface };

        _credentials.Dock = DockStyle.Fill;
        _credentials.Visible = false;
        _credentials.View = View.Details;
        _credentials.FullRowSelect = true;
        _credentials.MultiSelect = false;
        _credentials.Columns.Add("شناسه", 200);
        _credentials.Columns.Add("نام کاربری", 300);
        _credentials.Columns.Add("ذخیره‌سازی", 150);
        var credentialList = new Panel { Dock = DockStyle.Fill, BackColor = BridgeUi.Surface };
        credentialList.Controls.Add(_credentials);
        _credentialsEmpty.Dock = DockStyle.Fill;
        _credentialsEmpty.BackColor = BridgeUi.Surface;
        _credentialsEmpty.ForeColor = BridgeUi.Muted;
        _credentialsEmpty.Font = BridgeUi.Font(11.5f);
        _credentialsEmpty.TextAlign = ContentAlignment.MiddleCenter;
        _credentialsEmpty.Text = "هنوز اعتبارنامه‌ای ثبت نشده است.\nبرای افزودن امن رمز، دکمهٔ «افزودن» را انتخاب کن.";
        credentialList.Controls.Add(_credentialsEmpty);
        _credentialsEmpty.BringToFront();
        panel.Controls.Add(credentialList);

        var top = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, FlowDirection = FlowDirection.RightToLeft, WrapContents = true, Padding = new Padding(0, 4, 0, 8) };
        top.Controls.Add(ActionButton("افزودن", AddCredentialAsync));
        top.Controls.Add(ActionButton("ویرایش", EditCredentialAsync));
        top.Controls.Add(ActionButton("حذف", DeleteCredentialAsync));
        top.Controls.Add(ActionButton("تازه‌سازی", RefreshCredentialsAsync));
        panel.Controls.Add(top);

        var note = new Label
        {
            Dock = DockStyle.Bottom,
            Height = 70,
            Text = "رمزها به‌صورت رمزگذاری‌شده برای کاربر فعلی ویندوز نگهداری می‌شوند. مقدار رمز در گزارش‌ها نمایش داده نمی‌شود.",
            AutoEllipsis = true,
            ForeColor = BridgeUi.Muted,
            Font = BridgeUi.Font(10.2f),
            Padding = new Padding(8)
        };
        panel.Controls.Add(note);
        page.Controls.Add(panel);
        return page;
    }

    private string BrowserCredentialHelper()
    {
        var p = Path.Combine(_installRoot, "browser", "sokna-browser-qa.exe");
        if (!File.Exists(p)) throw new FileNotFoundException("Browser credential helper پیدا نشد.", p);
        return p;
    }

    private async Task<JsonObject> RunCredentialHelperAsync(string operation, string id = "", string username = "", string? secret = null)
    {
        var psi = new ProcessStartInfo(BrowserCredentialHelper())
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = secret is not null,
            WorkingDirectory = _installRoot
        };
        psi.ArgumentList.Add("credential");
        psi.ArgumentList.Add(operation);
        if (!string.IsNullOrWhiteSpace(id)) { psi.ArgumentList.Add("--id"); psi.ArgumentList.Add(id); }
        if (operation == "set") { psi.ArgumentList.Add("--username"); psi.ArgumentList.Add(username ?? ""); }

        using var p = Process.Start(psi) ?? throw new InvalidOperationException("Credential helper اجرا نشد.");
        if (secret is not null)
        {
            await p.StandardInput.WriteAsync(secret);
            p.StandardInput.Close();
        }
        var stdoutTask = p.StandardOutput.ReadToEndAsync();
        var stderrTask = p.StandardError.ReadToEndAsync();
        await p.WaitForExitAsync();
        var stdout = await stdoutTask; var stderr = await stderrTask;
        if (p.ExitCode != 0) throw new InvalidOperationException(string.IsNullOrWhiteSpace(stderr) ? "Credential operation failed." : stderr.Trim());
        return JsonNode.Parse(stdout)?.AsObject() ?? throw new InvalidDataException("Credential helper پاسخ معتبر نداد.");
    }

    private async Task RefreshCredentialsAsync()
    {
        try
        {
            var result = await RunCredentialHelperAsync("list");
            _credentials.Items.Clear();
            if (result["credentials"] is JsonArray items)
            {
                foreach (var node in items.OfType<JsonObject>())
                {
                    var id = node["id"]?.GetValue<string>() ?? "";
                    var username = node["username"]?.GetValue<string>() ?? "";
                    var row = new ListViewItem(id);
                    row.SubItems.Add(username);
                    row.SubItems.Add("Windows DPAPI");
                    row.Tag = new[] { id, username };
                    _credentials.Items.Add(row);
                }
            }
            _credentials.Visible = _credentials.Items.Count > 0;
            _credentialsEmpty.Visible = !_credentials.Visible;
        }
        catch (Exception ex) { _credentials.Visible = false; _credentialsEmpty.Visible = true; ShowError(ex); }
    }

    private async Task AddCredentialAsync()
    {
        using var dialog = new CredentialDialog();
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        try
        {
            await RunCredentialHelperAsync("set", dialog.CredentialId, dialog.UsernameValue, dialog.SecretValue);
            await RefreshCredentialsAsync();
        }
        catch (Exception ex) { ShowError(ex); }
    }

    private async Task EditCredentialAsync()
    {
        if (_credentials.SelectedItems.Count != 1) { MessageBox.Show(this, "یک Credential را انتخاب کن.", Text); return; }
        var data = _credentials.SelectedItems[0].Tag as string[] ?? Array.Empty<string>();
        var id = data.ElementAtOrDefault(0) ?? "";
        var username = data.ElementAtOrDefault(1) ?? "";
        using var dialog = new CredentialDialog(id, username);
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        try
        {
            await RunCredentialHelperAsync("set", id, dialog.UsernameValue, dialog.SecretValue);
            await RefreshCredentialsAsync();
        }
        catch (Exception ex) { ShowError(ex); }
    }

    private async Task DeleteCredentialAsync()
    {
        if (_credentials.SelectedItems.Count != 1) { MessageBox.Show(this, "یک Credential را انتخاب کن.", Text); return; }
        var data = _credentials.SelectedItems[0].Tag as string[] ?? Array.Empty<string>();
        var id = data.ElementAtOrDefault(0) ?? "";
        if (MessageBox.Show(this, $"Credential «{id}» حذف شود؟", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;
        try
        {
            await RunCredentialHelperAsync("delete", id);
            await RefreshCredentialsAsync();
        }
        catch (Exception ex) { ShowError(ex); }
    }

    private TabPage BuildGettingStartedTab()
    {
        var page = NewPage("راهنمای شروع");
        var root = Stack();

        root.Controls.Add(SectionTitle("برای استفاده از SOKNA Bridge این مراحل را انجام بده"));

        root.Controls.Add(Step("۱", "از وضعیت Agent مطمئن شو", "در تب «وضعیت»، اتصال Agent را بررسی کن. اگر متوقف است، آن را راه‌اندازی کن."));
        root.Controls.Add(Step("۲", "افزونهٔ Chrome را نصب کن", "در Google Chrome به chrome://extensions برو؛ Developer mode را روشن کن، Load unpacked را بزن و پوشه دائمی افزونه نصب‌شده را انتخاب کن."));
        root.Controls.Add(Step("۳", "فضای کاری تعریف کن", "از تب «فضاهای کاری» پوشهٔ مجاز را ثبت کن. دسترسی نوشتن فقط برای پروژه‌های مورد اعتماد مناسب است."));
        root.Controls.Add(Step("۴", "گفتگو را به بریج متصل کن", "در ChatGPT روی افزونهٔ بریج بزن و «Connect this Chat» را انتخاب کن. اتصال نهایی باید تأیید شود."));
        root.Controls.Add(Step("۵", "در صورت مشکل، عیب‌یابی را باز کن", "از بخش عیب‌یابی همین پنل شروع کن؛ تنها اگر لازم بود بستهٔ پشتیبانی بساز."));

        var extPath = Path.Combine(_installRoot, "extension");
        _extensionInfo.Text = "پوشهٔ افزونه: " + extPath;
        _extensionInfo.AutoSize = true;
        _extensionInfo.MaximumSize = new Size(850, 0);
        _extensionInfo.Margin = new Padding(8, 18, 8, 8);
        root.Controls.Add(_extensionInfo);

        var extButtons = ButtonRow();
        extButtons.Controls.Add(ActionButton("باز کردن پوشه افزونه", () => OpenFolder(extPath)));
        extButtons.Controls.Add(ActionButton("کپی مسیر افزونه", () => Clipboard.SetText(extPath)));
        extButtons.Controls.Add(ActionButton("افزونه‌های Chrome", () => OpenBrowserExtensions("chrome.exe", "chrome://extensions")));
        // Edge excluded from supported operator workflow.
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

    internal void ShowLayoutError()
    {
        _lastError.Text = "BR-AGENT-001 — Agent پاسخ نمی‌دهد؛ راهنمای عیب‌یابی را بررسی کن.";
        _errorDetails.Text = "BR-AGENT-001: synthetic connection-unavailable UI test fixture";
        _errorPanel.Visible = true;
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

            _shellVersion.Text = Application.ProductVersion;
            _version.Text = ReadProductVersion();
            _port.Text = port.ToString();
            _artifact.Text = artifact;

            try
            {
                var ping = await AgentCallAsync("ping", new { });
                var ok = ping["ok"]?.GetValue<bool>() == true;
                _status.Text = ok ? "● Agent در حال اجرا" : "● Agent پاسخ سالم نداد";
                _statusGuidance.Text = ok
                    ? "اتصال محلی تأیید شد."
                    : "BR-AGENT-002 — پاسخ Agent نامعتبر است؛ از بخش عیب‌یابی بررسی کن.";
                _status.ForeColor = ok ? BridgeUi.Good : BridgeUi.Danger;
            }
            catch (Exception ex)
            {
                _status.Text = "● Agent در دسترس نیست";
                _statusGuidance.Text = "BR-AGENT-001 — ابتدا «شروع Agent» را بزن؛ اگر مشکل باقی ماند عیب‌یابی را باز کن.";
                _status.ForeColor = BridgeUi.Danger;
                _lastError.Text = ex.Message;
            }

            await RefreshWorkspacesAsync(silent: true);
            try { await RefreshCredentialsAsync(); } catch { }
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
            _workspaces.Visible = _workspaces.Items.Count > 0;
            _workspacesEmpty.Visible = !_workspaces.Visible;
        }
        catch (Exception ex)
        {
            _workspaceCount.Text = "—";
            _workspacesEmpty.Text = "فهرست فضاهای کاری در دسترس نیست. اتصال Agent را بررسی کن.";
            _workspacesEmpty.Visible = true;
            _workspaces.Visible = false;
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
            _diagnosticsEmpty.Visible = false;
            _diagnosticsBox.Visible = true;
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
            _diagnosticsEmpty.Visible = false;
            _diagnosticsBox.Visible = true;
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
        _diagnosticsEmpty.Visible = false;
            _diagnosticsBox.Visible = true;
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
            if (action == "stop" && MessageBox.Show(this,
                "Agent متوقف شود؟ تا شروع مجدد، درخواست‌های محلی پاسخ داده نمی‌شوند.",
                "تأیید توقف Agent", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;
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
            MessageBox.Show(this, partial ? $"بسته پشتیبانی ساخته شد، اما {count} فایل قابل خواندن نبود و در bundle-errors.json ثبت شد.\n{dlg.FileName}" : "بسته پشتیبانی کامل ساخته شد:\n" + dlg.FileName, Text, MessageBoxButtons.OK, partial ? MessageBoxIcon.Warning : MessageBoxIcon.Information);
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

    private static TabPage NewPage(string title) => new(title) { Padding = new Padding(8), BackColor = BridgeUi.Canvas };

    // A single-column TableLayoutPanel fills available horizontal space.
    // The former nested FlowLayoutPanels collapsed cards toward the right
    // despite geometry tests passing; this also removes hard-coded card widths.
    private static TableLayoutPanel Stack()
    {
        var stack = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoScroll = true,
            ColumnCount = 1,
            GrowStyle = TableLayoutPanelGrowStyle.AddRows,
            BackColor = BridgeUi.Canvas,
            Padding = new Padding(18, 13, 18, 14)
        };
        stack.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        stack.ControlAdded += (_, e) =>
        {
            e.Control.Dock = DockStyle.Top;
        };
        return stack;
    }

    private static FlowLayoutPanel ButtonRow() => new()
    {
        AutoSize = true,
        FlowDirection = FlowDirection.RightToLeft,
        RightToLeft = RightToLeft.No,
        WrapContents = true,
        Margin = new Padding(8, 4, 8, 8)
    };

    private Button ActionButton(string text, Action action)
    {
        var b = new Button { Text = text };
        BridgeUi.Button(b);
        b.Click += (_, _) => { try { action(); } catch (Exception ex) { ShowError(ex); } };
        return b;
    }

    private Button ActionButton(string text, Func<Task> action)
    {
        var b = new Button { Text = text };
        BridgeUi.Button(b);
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
        row.Controls.Add(new Label { Text = name + ":", AutoSize = true, Font = BridgeUi.Font(10f, FontStyle.Bold), Margin = new Padding(5) });
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
        Font = BridgeUi.Font(14.5f, FontStyle.Bold),
        Margin = new Padding(8, 22, 8, 10)
    };

    private static TableLayoutPanel Card(string title)
    {
        var card = new TableLayoutPanel
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Dock = DockStyle.Top,
            ColumnCount = 1,
            GrowStyle = TableLayoutPanelGrowStyle.AddRows,
            Padding = new Padding(14, 12, 14, 14),
            Margin = new Padding(7, 5, 7, 9),
            BorderStyle = BorderStyle.FixedSingle,
            RightToLeft = RightToLeft.Yes,
            BackColor = BridgeUi.Surface
        };
        card.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        card.ControlAdded += (_, e) => { e.Control.Dock = DockStyle.Top; };
        card.Controls.Add(new Label
        {
            Text = title, AutoSize = false, Height = 38,
            Font = BridgeUi.Font(12.2f, FontStyle.Bold),
            ForeColor = BridgeUi.BrandDark,
            RightToLeft = RightToLeft.Yes,
            // WinForms mirrors TextAlign under RTL; MiddleLeft paints on the visual right.
            TextAlign = ContentAlignment.MiddleLeft,
            Margin = new Padding(5, 2, 5, 12)
        });
        return card;
    }

    private static void AddInfo(TableLayoutPanel table, int row, string name, Label value)
    {
        while (table.RowCount <= row) { table.RowStyles.Add(new RowStyle(SizeType.AutoSize)); table.RowCount++; }
        table.Controls.Add(new Label { Text = name, AutoSize = true, Font = BridgeUi.Font(10.6f, FontStyle.Bold), Margin = new Padding(6) }, 0, row);
        value.Text = "—"; value.AutoSize = true; value.MaximumSize = new Size(620, 0); value.Margin = new Padding(6);
        table.Controls.Add(value, 1, row);
    }

    private Button StyledButton(string text, Action action, string style) => Style(ActionButton(text, action), style);
    private Button StyledButton(string text, Func<Task> action, string style) => Style(ActionButton(text, action), style);
    private static Button Style(Button b, string style)
    {
        BridgeUi.Button(b, style);
        return b;
    }

    private static Control Step(string number, string title, string detail)
    {
        var table = new TableLayoutPanel { Width = 720, AutoSize = true, ColumnCount = 2, RightToLeft = RightToLeft.Yes, Margin = new Padding(8, 6, 8, 6), Padding = new Padding(14), BorderStyle = BorderStyle.FixedSingle, BackColor = BridgeUi.Surface };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 64)); table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        var n = new Label { Text = number, AutoSize = false, Width = 42, Height = 42, TextAlign = ContentAlignment.MiddleCenter, Font = BridgeUi.Font(13f, FontStyle.Bold), BorderStyle = BorderStyle.FixedSingle, Margin = new Padding(6) };
        var text = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Margin = new Padding(6) };
        text.Controls.Add(new Label { Text = title, AutoSize = true, Font = BridgeUi.Font(11.4f, FontStyle.Bold) });
        text.Controls.Add(new Label { Text = detail, AutoSize = true, MaximumSize = new Size(625, 0), Font = BridgeUi.Font(10.3f), ForeColor = BridgeUi.Muted, Margin = new Padding(0, 6, 0, 0) });
        table.Controls.Add(n, 0, 0); table.Controls.Add(text, 1, 0); return table;
    }}
