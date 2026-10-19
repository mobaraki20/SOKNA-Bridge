namespace Sokna.Bridge.ControlCenter;

internal sealed class CredentialDialog : Form
{
    private readonly TextBox _id = new();
    private readonly TextBox _username = new();
    private readonly TextBox _secret = new();

    internal string CredentialId => _id.Text.Trim();
    internal string UsernameValue => _username.Text;
    internal string SecretValue => _secret.Text;

    internal CredentialDialog(string? id = null, string? username = null)
    {
        Text = string.IsNullOrWhiteSpace(id) ? "افزودن اعتبارنامه" : "ویرایش اعتبارنامه";
        ClientSize = new Size(590, 465);
        MinimumSize = new Size(530, 430);
        StartPosition = FormStartPosition.CenterParent;
        BridgeUi.Prepare(this);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;

        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill, Padding = new Padding(22),
            ColumnCount = 1, RowCount = 6, BackColor = BridgeUi.Canvas
        };
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        foreach (var height in new[] { 49f, 73f, 73f, 73f, 78f })
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        root.Controls.Add(new Label
        {
            Text = string.IsNullOrWhiteSpace(id) ? "اعتبارنامهٔ جدید" : "ویرایش اطلاعات اعتبارنامه",
            AutoSize = true, Font = BridgeUi.Font(15f, FontStyle.Bold),
            ForeColor = BridgeUi.BrandDark,
            Margin = new Padding(0, 1, 0, 5)
        }, 0, 0);

        _id.Text = id ?? "";
        _id.Enabled = string.IsNullOrWhiteSpace(id);
        _id.RightToLeft = RightToLeft.No;
        _id.TextAlign = HorizontalAlignment.Left;
        root.Controls.Add(Field("شناسه انگلیسی", _id), 0, 1);

        _username.Text = username ?? "";
        _username.RightToLeft = RightToLeft.No;
        _username.TextAlign = HorizontalAlignment.Left;
        root.Controls.Add(Field("نام کاربری", _username), 0, 2);

        _secret.UseSystemPasswordChar = true;
        _secret.RightToLeft = RightToLeft.No;
        _secret.TextAlign = HorizontalAlignment.Left;
        root.Controls.Add(Field("رمز محرمانه", _secret), 0, 3);

        var note = BridgeUi.Caption("رمز با Windows DPAPI برای کاربر فعلی رمزگذاری می‌شود و به ChatGPT نمایش داده نمی‌شود. هنگام ویرایش، رمز جدید لازم است.");
        note.MaximumSize = new Size(520, 0);
        root.Controls.Add(note, 0, 4);

        var actions = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill, RightToLeft = RightToLeft.No,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false, Padding = new Padding(0, 7, 0, 0)
        };
        var save = new Button { Text = "ذخیره", DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "انصراف", DialogResult = DialogResult.Cancel };
        BridgeUi.Button(save, "primary");
        BridgeUi.Button(cancel);
        actions.Controls.Add(save);
        actions.Controls.Add(cancel);
        root.Controls.Add(actions, 0, 5);
        AcceptButton = save;
        CancelButton = cancel;

        save.Click += (_, _) =>
        {
            if (string.IsNullOrWhiteSpace(CredentialId) ||
                !System.Text.RegularExpressions.Regex.IsMatch(CredentialId, "^[A-Za-z0-9._-]{1,100}$"))
            {
                MessageBox.Show(this, "شناسه باید انگلیسی باشد و فقط حروف، عدد، نقطه، خط تیره و زیرخط داشته باشد.",
                    Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                DialogResult = DialogResult.None;
                return;
            }
            if (string.IsNullOrEmpty(SecretValue))
            {
                MessageBox.Show(this, "رمز محرمانه خالی است.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                DialogResult = DialogResult.None;
            }
        };

        Controls.Add(root);
        BridgeUi.Fields(root);
    }

    private static TableLayoutPanel Field(string label, TextBox input)
    {
        var area = new TableLayoutPanel
        {
            Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2,
            Padding = Padding.Empty, Margin = Padding.Empty,
            BackColor = BridgeUi.Canvas
        };
        area.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        area.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        area.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        area.Controls.Add(BridgeUi.FieldLabel(label), 0, 0);
        input.Dock = DockStyle.Top;
        input.Height = 35;
        input.Margin = new Padding(3, 1, 3, 0);
        area.Controls.Add(input, 0, 1);
        return area;
    }
}
