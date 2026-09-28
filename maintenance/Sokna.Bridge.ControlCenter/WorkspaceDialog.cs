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
        Text = "افزودن Workspace";
        Width = 650;
        Height = 350;
        StartPosition = FormStartPosition.CenterParent;
        Font = new Font("Segoe UI", 10f);
        RightToLeft = RightToLeft.Yes;
        RightToLeftLayout = true;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;

        var table = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(18), ColumnCount = 3, RowCount = 5 };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 130));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 100));

        table.Controls.Add(new Label { Text = "پوشه:", AutoSize = true, Anchor = AnchorStyles.Right }, 0, 0);
        _path.Dock = DockStyle.Fill;
        table.Controls.Add(_path, 1, 0);
        var browse = new Button { Text = "انتخاب…" };
        browse.Click += (_, _) => ChooseFolder();
        table.Controls.Add(browse, 2, 0);

        table.Controls.Add(new Label { Text = "شناسه:", AutoSize = true, Anchor = AnchorStyles.Right }, 0, 1);
        _id.Dock = DockStyle.Fill;
        table.Controls.Add(_id, 1, 1);
        table.SetColumnSpan(_id, 2);

        table.Controls.Add(new Label { Text = "نام نمایشی:", AutoSize = true, Anchor = AnchorStyles.Right }, 0, 2);
        _display.Dock = DockStyle.Fill;
        table.Controls.Add(_display, 1, 2);
        table.SetColumnSpan(_display, 2);

        table.Controls.Add(new Label { Text = "نوع دسترسی:", AutoSize = true, Anchor = AnchorStyles.Right }, 0, 3);
        _access.Items.AddRange(["فقط خواندن", "توسعه — خواندن/نوشتن + ابزارهای توسعه"]);
        _access.SelectedIndex = 0;
        _access.DropDownStyle = ComboBoxStyle.DropDownList;
        _access.Dock = DockStyle.Fill;
        table.Controls.Add(_access, 1, 3);
        table.SetColumnSpan(_access, 2);

        var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Dock = DockStyle.Fill };
        var ok = new Button { Text = "افزودن", DialogResult = DialogResult.None, AutoSize = true };
        var cancel = new Button { Text = "انصراف", DialogResult = DialogResult.Cancel, AutoSize = true };
        ok.Click += (_, _) => ValidateAndClose();
        buttons.Controls.Add(ok); buttons.Controls.Add(cancel);
        table.Controls.Add(buttons, 0, 4);
        table.SetColumnSpan(buttons, 3);

        Controls.Add(table);
        CancelButton = cancel;
    }

    private void ChooseFolder()
    {
        using var dlg = new FolderBrowserDialog { Description = "پوشه Workspace را انتخاب کن", UseDescriptionForTitle = true };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        _path.Text = dlg.SelectedPath;
        var name = new DirectoryInfo(dlg.SelectedPath).Name;
        if (string.IsNullOrWhiteSpace(_display.Text)) _display.Text = name;
        if (string.IsNullOrWhiteSpace(_id.Text)) _id.Text = Slug(name);
    }

    private void ValidateAndClose()
    {
        if (!Directory.Exists(WorkspacePath)) { MessageBox.Show(this, "پوشه انتخاب‌شده وجود ندارد."); return; }
        if (string.IsNullOrWhiteSpace(WorkspaceId) || WorkspaceId.Any(ch => !(char.IsLetterOrDigit(ch) || ch is '-' or '_' or '.')))
        { MessageBox.Show(this, "شناسه فقط می‌تواند شامل حروف، عدد، خط تیره، زیرخط یا نقطه باشد."); return; }
        if (string.IsNullOrWhiteSpace(DisplayNameValue)) _display.Text = WorkspaceId;
        DialogResult = DialogResult.OK;
        Close();
    }

    private static string Slug(string value)
    {
        var chars = value.Select(ch => char.IsLetterOrDigit(ch) ? char.ToLowerInvariant(ch) : '-').ToArray();
        var s = new string(chars).Trim('-');
        while (s.Contains("--")) s = s.Replace("--", "-");
        return string.IsNullOrWhiteSpace(s) ? "workspace" : s;
    }
}
