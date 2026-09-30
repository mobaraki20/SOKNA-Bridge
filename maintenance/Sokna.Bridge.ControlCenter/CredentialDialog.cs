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
        Text = string.IsNullOrWhiteSpace(id) ? "افزودن Credential" : "ویرایش Credential";
        Width = 560;
        Height = 320;
        MinimumSize = new Size(500, 300);
        StartPosition = FormStartPosition.CenterParent;
        Font = new Font("Tahoma", 10f);
        RightToLeft = RightToLeft.Yes;
        RightToLeftLayout = true;

        var table = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(18), ColumnCount = 2, RowCount = 5 };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 140));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        table.Controls.Add(new Label { Text = "شناسه", AutoSize = true, Margin = new Padding(8) }, 0, 0);
        _id.Text = id ?? ""; _id.Enabled = string.IsNullOrWhiteSpace(id); _id.Dock = DockStyle.Fill;
        table.Controls.Add(_id, 1, 0);

        table.Controls.Add(new Label { Text = "نام کاربری", AutoSize = true, Margin = new Padding(8) }, 0, 1);
        _username.Text = username ?? ""; _username.Dock = DockStyle.Fill;
        table.Controls.Add(_username, 1, 1);

        table.Controls.Add(new Label { Text = "رمز / Secret", AutoSize = true, Margin = new Padding(8) }, 0, 2);
        _secret.UseSystemPasswordChar = true; _secret.Dock = DockStyle.Fill;
        table.Controls.Add(_secret, 1, 2);

        var note = new Label
        {
            Text = "Secret فقط در Windows DPAPI کاربر فعلی ذخیره می‌شود و به ChatGPT نمایش داده نمی‌شود.",
            AutoSize = true, MaximumSize = new Size(360, 0), ForeColor = Color.DimGray, Margin = new Padding(8)
        };
        table.Controls.Add(note, 1, 3);

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, FlowDirection = FlowDirection.RightToLeft, Margin = new Padding(8) };
        var save = new Button { Text = "ذخیره", AutoSize = true, DialogResult = DialogResult.OK, Padding = new Padding(12, 6, 12, 6) };
        var cancel = new Button { Text = "انصراف", AutoSize = true, DialogResult = DialogResult.Cancel, Padding = new Padding(12, 6, 12, 6) };
        buttons.Controls.Add(save); buttons.Controls.Add(cancel); table.Controls.Add(buttons, 1, 4);
        AcceptButton = save; CancelButton = cancel;

        save.Click += (_, e) =>
        {
            if (string.IsNullOrWhiteSpace(CredentialId) || !System.Text.RegularExpressions.Regex.IsMatch(CredentialId, "^[A-Za-z0-9._-]{1,100}$"))
            {
                MessageBox.Show(this, "شناسه فقط می‌تواند شامل حروف، عدد، نقطه، خط تیره و underscore باشد.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                DialogResult = DialogResult.None; return;
            }
            if (string.IsNullOrEmpty(SecretValue))
            {
                MessageBox.Show(this, "Secret خالی است.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                DialogResult = DialogResult.None;
            }
        };

        Controls.Add(table);
    }
}
