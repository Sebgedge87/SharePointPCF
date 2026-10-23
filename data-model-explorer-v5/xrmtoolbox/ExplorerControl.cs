using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using McTools.Xrm.Connection;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Xrm.Sdk;
using XrmToolBox.Extensibility;

namespace FormusPro.DataModelExplorer
{
    // The Data Model Explorer page inside XrmToolBox.
    //
    // The page is shown in WebView2 (Edge) at the connected environment's web resource address, so it switches into
    // its "inside Dynamics 365" mode by itself. Nothing is fetched from that address: the page comes from this dll, and
    // the page's Web API requests are sent on with XrmToolBox's access token. Only GET requests are passed on, so the
    // tool can read the environment but never change it.
    public class ExplorerControl : PluginControlBase
    {
        const string PagePath = "/WebResources/formus_/dme/DataModelExplorer.html";
        static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromMinutes(3) };
        static byte[] page;

        readonly WebView2 web = new WebView2 { Dock = DockStyle.Fill };
        readonly System.Windows.Forms.Label message = new System.Windows.Forms.Label { Dock = DockStyle.Fill, TextAlign = System.Drawing.ContentAlignment.MiddleCenter, Visible = false, Padding = new Padding(40) };
        string org;        // https://<org>.crm.dynamics.com, the address the page is shown at
        bool ready;

        public ExplorerControl()
        {
            Controls.Add(web);
            Controls.Add(message);
            Load += async (s, e) => await StartAsync();
        }

        async Task StartAsync()
        {
            try
            {
                // its own browser profile, kept between sessions: open workbooks, edits and ERD layouts stay
                var profile = Path.Combine(Paths.SettingsPath, "DataModelExplorer.WebView2");
                var env = await CoreWebView2Environment.CreateAsync(null, profile);
                await web.EnsureCoreWebView2Async(env);
            }
            catch (Exception ex)
            {
                Say("Data Model Explorer needs the Microsoft Edge WebView2 Runtime, which comes with Windows 10 and 11.\r\n" +
                    "Install it from https://developer.microsoft.com/microsoft-edge/webview2/ and open the tool again.\r\n\r\n" + ex.Message);
                return;
            }
            var cw = web.CoreWebView2;
            cw.Settings.IsStatusBarEnabled = false;
            cw.WebResourceRequested += OnRequest;
            // links the page opens in a new window (Microsoft Learn, maker portal) go to the normal browser
            cw.NewWindowRequested += (s, e) => { e.Handled = true; OpenInBrowser(e.Uri); };
            ready = true;
            ExecuteMethod(Open);   // asks for a connection if there isn't one yet
        }

        // Show the page for the current connection.
        void Open()
        {
            if (!ready || ConnectionDetail == null) return;
            var next = OrgUrl(ConnectionDetail);
            if (next == null) { Say("Could not tell the environment's address from this connection."); return; }
            var cw = web.CoreWebView2;
            if (org != null) cw.RemoveWebResourceRequestedFilter(org + "/*", CoreWebView2WebResourceContext.All);
            org = next;
            cw.AddWebResourceRequestedFilter(org + "/*", CoreWebView2WebResourceContext.All);
            message.Visible = false; web.Visible = true;
            cw.Navigate(org + PagePath);
        }

        public override void UpdateConnection(IOrganizationService newService, ConnectionDetail detail, string actionName, object parameter)
        {
            base.UpdateConnection(newService, detail, actionName, parameter);
            Open();   // a new connection reopens the page on that environment
        }

        static string OrgUrl(ConnectionDetail d)
        {
            var url = d.WebApplicationUrl;
            if (string.IsNullOrWhiteSpace(url)) url = d.ServiceClient?.CrmConnectOrgUriActual?.ToString();
            if (string.IsNullOrWhiteSpace(url) || !Uri.TryCreate(url, UriKind.Absolute, out var u)) return null;
            return u.GetLeftPart(UriPartial.Authority).ToLowerInvariant();
        }

        async void OnRequest(object sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            var deferral = e.GetDeferral();
            try
            {
                var path = new Uri(e.Request.Uri).AbsolutePath;
                if (path.Equals(PagePath, StringComparison.OrdinalIgnoreCase))
                    e.Response = Respond(200, "OK", Page(), "text/html; charset=utf-8");
                else if (path.StartsWith("/api/data/", StringComparison.OrdinalIgnoreCase))
                    e.Response = await ForwardAsync(e.Request);
                else
                    e.Response = Respond(404, "Not Found", Encoding.UTF8.GetBytes("Not available inside XrmToolBox."), "text/plain");
            }
            catch (Exception ex)
            {
                e.Response = Error(502, "Bad Gateway", "The environment could not be reached: " + ex.Message);
            }
            finally
            {
                deferral.Complete();
            }
        }

        // Send one of the page's Web API requests to Dataverse, signed in as the XrmToolBox connection.
        async Task<CoreWebView2WebResourceResponse> ForwardAsync(CoreWebView2WebResourceRequest r)
        {
            if (!string.Equals(r.Method, "GET", StringComparison.OrdinalIgnoreCase))
                return Error(405, "Method Not Allowed", "Data Model Explorer only reads the environment.");
            var client = ConnectionDetail?.ServiceClient;
            var token = client == null ? null : await Task.Run(() => client.CurrentAccessToken);   // refreshed when it has expired
            if (string.IsNullOrEmpty(token))
                return Error(401, "Unauthorized", "This connection does not give an access token. Connect with Microsoft 365 sign-in (OAuth), a client secret or a certificate.");
            var msg = new HttpRequestMessage(HttpMethod.Get, r.Uri);
            msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            foreach (var h in new[] { "Accept", "OData-MaxVersion", "OData-Version", "Prefer" })
                if (r.Headers.Contains(h)) msg.Headers.TryAddWithoutValidation(h, r.Headers.GetHeader(h));
            using (var res = await Http.SendAsync(msg))
            {
                var body = await res.Content.ReadAsByteArrayAsync();
                var type = res.Content.Headers.ContentType?.ToString() ?? "application/json";
                return Respond((int)res.StatusCode, res.ReasonPhrase, body, type);
            }
        }

        CoreWebView2WebResourceResponse Respond(int status, string reason, byte[] body, string type) =>
            web.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(body), status, reason,
                "Content-Type: " + type + "\r\nCache-Control: no-store");

        // an error in the shape Dataverse uses, so the page shows the message
        CoreWebView2WebResourceResponse Error(int status, string reason, string text) =>
            Respond(status, reason, Encoding.UTF8.GetBytes("{\"error\":{\"message\":" + JsonString(text) + "}}"), "application/json");

        static string JsonString(string s)
        {
            var b = new StringBuilder("\"");
            foreach (var c in s)
            {
                if (c == '"' || c == '\\') b.Append('\\').Append(c);
                else if (c < ' ') b.AppendFormat("\\u{0:x4}", (int)c);
                else b.Append(c);
            }
            return b.Append('"').ToString();
        }

        static byte[] Page()
        {
            if (page != null) return page;
            using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("DataModelExplorer.html"))
            using (var m = new MemoryStream())
            {
                s.CopyTo(m);
                return page = m.ToArray();
            }
        }

        void Say(string text)
        {
            message.Text = text; message.Visible = true; web.Visible = false;
        }

        static void OpenInBrowser(string uri)
        {
            if (Uri.TryCreate(uri, UriKind.Absolute, out var u) && (u.Scheme == Uri.UriSchemeHttps || u.Scheme == Uri.UriSchemeHttp))
                Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true });
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) web.Dispose();
            base.Dispose(disposing);
        }
    }
}
