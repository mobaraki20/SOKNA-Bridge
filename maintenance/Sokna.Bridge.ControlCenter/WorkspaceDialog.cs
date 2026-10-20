namespace Sokna.Bridge.ControlCenter;

internal sealed class WorkspaceDialog : Form
{
    private readonly TextBox _path = new();
    private readonly TextBox _id = new();
    private readonly TextBox _display = new();
    private readonly ComboBox _access = new();

    internal string WorkspacePath => _path.Text.Trim();
    internal string WorkspaceId => _id.Text.Trim();
    internal string DisplayNameValue => _display.Text.Trim();
    internal bool DevelopmentAccess => _access.SelectedIndex == 1;

    internal WorkspaceDialog()
    {
        Text = "افزودن فضای کاری";
        ClientSize = new Size(680, 486);
        MinimumSize = new Size(620, 505);
        StartPosition = FormStartPosition.CenterParent;
        BridgeUi.Prepare(this);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;

        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill, Padding = new Padding(20),
            ColumnCount = 1, RowCount = 7, BackColor = BridgeUi.Canvas
        };
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        foreach (var px in new[] { 43f, 80f, 66f, 66f, 70f, 67f })
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, px));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        root.Controls.Add(new Label
        {
            Text = "فضای کاری جدید",
            AutoSize = true,
            Font = BridgeUi.Font(15f, FontStyle.Bold),
            ForeColor = BridgeUi.BrandDark,
            Margin = new Padding(0, 1, 0, 5)
        }, 0, 0);

        _path.RightToLeft = RightToLeft.No;
        _path.TextAlign = HorizontalAlignment.Left;
        var pathField = Field("مسیر پوشه", _path, hasBrowse: true);
        var pathRow = (TableLayoutPanel)pathField.Controls[1];
        var browse = new Button { Text = "انتخاب پوشه" };
        BridgeUi.Button(browse);
        browse.Click += (_, _) => ChooseFolder();
        pathRow.Controls.Add(browse, 1, 0);
        root.Controls.Add(pathField, 0, 1);

        _id.RightToLeft = RightToLeft.No;
        _id.TextAlign = HorizontalAlignment.Left;
        root.Controls.Add(Field("شناسه انگلیسی", _id), 0, 2);
        root.Controls.Add(Field("نام نمایشی", _display), 0, 3);

        _access.Items.AddRange(["فقط خواندن", "توسعه — خواندن و نوشتن با ابزارهای توسعه"]);
        _access.SelectedIndex = 0;
        _access.DropDownStyle = ComboBoxStyle.DropDownList;
        root.Controls.Add(Field("سطح دسترسی", _access), 0, 4);

        var guidance = BridgeUi.Caption("برای پروژه‌های معمولی، «فقط خواندن» امن‌تر است. دسترسی توسعه را فقط برای پوشه‌های مورد اعتماد فعال کن.");
        guidance.MaximumSize = new Size(590, 0);
        root.Controls.Add(guidance, 0, 5);

        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill, AutoSize = false,
            RightToLeft = RightToLeft.No, FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false, Padding = new Padding(0, 7, 0, 0),
            BackColor = BridgeUi.Canvas
        };
        var ok = new Button { Text = "افزودن", DialogResult = DialogResult.None };
        var cancel = new Button { Text = "انصراف", DialogResult = DialogResult.Cancel };
        BridgeUi.Button(ok, "primary");
        BridgeUi.Button(cancel);
        ok.Click += (_, _) => ValidateAndClose();
        buttons.Controls.Add(ok);
        buttons.Controls.Add(cancel);
        root.Controls.Add(buttons, 0, 6);

        Controls.Add(root);
        AcceptButton = ok;
        CancelButton = cancel;
        BridgeUi.Fields(root);
    }

    // The nested field has a dedicated right-to-left label row followed by
    // an explicit LTR-friendly path input and a separate browse action slot.
    private static TableLayoutPanel Field(string title, Control input, bool hasBrowse = false)
    {
        var field = new TableLayoutPanel
        {
            Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2,
            Padding = Padding.Empty, Margin = Padding.Empty,
            BackColor = BridgeUi.Canvas
        };
        field.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        field.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        field.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        field.Controls.Add(BridgeUi.FieldLabel(title), 0, 0);
        var row = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = hasBrowse ? 2 : 1, RowCount = 1, BackColor = BridgeUi.Canvas,
            RightToLeft = RightToLeft.Yes, Padding = Padding.Empty, Margin = Padding.Empty
        };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        if (hasBrowse) row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 130));
        row.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        input.Dock = DockStyle.Top;
        input.Height = 34;
        input.Margin = new Padding(3, 1, 5, 0);
        row.Controls.Add(input, 0, 0);
        field.Controls.Add(row, 0, 1);
        return field;
    }

    private void ChooseFolder()
    {
        using var dlg = new FolderBrowserDialog
        {
            Description = "پوشه فضای کاری را انتخاب کن",
            UseDescriptionForTitle = true
        };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        _path.Text = dlg.SelectedPath;
        var name = new DirectoryInfo(dlg.SelectedPath).Name;
        if (string.IsNullOrWhiteSpace(_display.Text)) _display.Text = name;
        if (string.IsNullOrWhiteSpace(_id.Text)) _id.Text = Slug(name);
    }

    private void ValidateAndClose()
    {
        if (!Directory.Exists(WorkspacePath))
        {
            MessageBox.Show(this, "پوشه انتخاب‌شده وجود ندارد.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        if (string.IsNullOrWhiteSpace(WorkspaceId) ||
            WorkspaceId.Any(ch => !(ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' ||
                char.IsAsciiDigit(ch) || ch is '-' or '_' or '.')))
        {
            MessageBox.Show(this, "شناسه باید انگلیسی باشد و فقط از حروف، عدد، خط تیره، زیرخط یا نقطه ساخته شود.",
                Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        if (string.IsNullOrWhiteSpace(DisplayNameValue)) _display.Text = WorkspaceId;
        DialogResult = DialogResult.OK;
        Close();
    }

    private static string Slug(string value)
    {
        var chars = value.Select(ch => (ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' ||
            char.IsAsciiDigit(ch)) ? char.ToLowerInvariant(ch) : '-').ToArray();
        var s = new string(chars).Trim('-');
        while (s.Contains("--", StringComparison.Ordinal)) s = s.Replace("--", "-", StringComparison.Ordinal);
        return string.IsNullOrWhiteSpace(s) ? "workspace" : s;
    }
}
