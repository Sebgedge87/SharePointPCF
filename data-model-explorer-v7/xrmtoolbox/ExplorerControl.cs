using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Linq;
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

namespace DataModelExplorer
{
    // The Data Model Explorer page inside XrmToolBox.
    //
    // The page is shown in WebView2 (Edge) at the connected environment's web resource address, so it switches into
    // its "inside Dynamics 365" mode by itself. Nothing is fetched from that address: the page comes from this dll, and
    // the page's Web API requests are sent on with XrmToolBox's access token. Only GET requests are passed on, so the
    // tool can read the environment but never change it.
    //
    // Other environments: XrmToolBox's extra connections (Add environment… on the page asks XrmToolBox for one). The page
    // reads them through /__dme/env/<id>/api/data/..., which is sent on to that environment with its own access token.
    public class ExplorerControl : MultipleConnectionsPluginControlBase
    {
        const string PagePath = "/WebResources/dme_/dme/DataModelExplorer.html";
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
            // saving back to a workbook the person opened: the page asks "Overwrite the original file?" itself, so the
            // browser's own permission prompt (a plain Windows box here) is answered for this page only
            cw.PermissionRequested += (s, e) =>
            {
                if (e.PermissionKind == CoreWebView2PermissionKind.FileReadWrite && org != null && e.Uri.StartsWith(org + "/", StringComparison.OrdinalIgnoreCase))
                { e.State = CoreWebView2PermissionState.Allow; e.Handled = true; }
            };
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

        // the extra connections changed: tell the page, which reads the list again
        protected override void ConnectionDetailsUpdated(NotifyCollectionChangedEventArgs e)
        {
            if (ready) web.CoreWebView2.PostWebMessageAsString("dme-envs");
        }

        // the environments the page can read: the main connection ("0"), then the extra ones
        List<KeyValuePair<string, ConnectionDetail>> Envs()
        {
            var list = new List<KeyValuePair<string, ConnectionDetail>>();
            if (ConnectionDetail != null) list.Add(new KeyValuePair<string, ConnectionDetail>("0", ConnectionDetail));
            foreach (var d in AdditionalConnectionDetails ?? Enumerable.Empty<ConnectionDetail>())
                if (d != null && d != ConnectionDetail) list.Add(new KeyValuePair<string, ConnectionDetail>(d.ConnectionId?.ToString("N") ?? d.ConnectionName, d));
            return list;
        }

        byte[] EnvsJson()
        {
            var b = new StringBuilder("{\"envs\":[");
            var first = true;
            foreach (var kv in Envs())
            {
                if (!first) b.Append(','); first = false;
                b.Append("{\"id\":").Append(JsonString(kv.Key))
                 .Append(",\"name\":").Append(JsonString(kv.Value.ConnectionName ?? ""))
                 .Append(",\"url\":").Append(JsonString(OrgUrl(kv.Value) ?? ""))
                 .Append(",\"main\":").Append(kv.Key == "0" ? "true" : "false").Append('}');
            }
            return Encoding.UTF8.GetBytes(b.Append("]}").ToString());
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
                var uri = new Uri(e.Request.Uri);
                if (path.Equals(PagePath, StringComparison.OrdinalIgnoreCase))
                    e.Response = Respond(200, "OK", Page(), "text/html; charset=utf-8");
                else if (path.StartsWith("/api/data/", StringComparison.OrdinalIgnoreCase))
                    e.Response = await ForwardAsync(e.Request, ConnectionDetail, e.Request.Uri);
                else if (path.Equals("/__dme/envs", StringComparison.OrdinalIgnoreCase))
                    e.Response = Respond(200, "OK", EnvsJson(), "application/json");
                else if (path.Equals("/__dme/envs/add", StringComparison.OrdinalIgnoreCase))
                {
                    BeginInvoke(new Action(() => AddAdditionalOrganization()));   // XrmToolBox's own connection picker
                    e.Response = Respond(202, "Accepted", Encoding.UTF8.GetBytes("{}"), "application/json");
                }
                else if (path.Equals("/__dme/envs/remove", StringComparison.OrdinalIgnoreCase))
                {
                    var id = Uri.UnescapeDataString((uri.Query.TrimStart('?').Split('&').FirstOrDefault(q => q.StartsWith("id=")) ?? "id=").Substring(3));
                    var d = Envs().FirstOrDefault(kv => kv.Key == id && kv.Key != "0").Value;
                    if (d != null) BeginInvoke(new Action(() => RemoveAdditionalOrganization(d)));
                    e.Response = Respond(200, "OK", Encoding.UTF8.GetBytes("{}"), "application/json");
                }
                else if (path.StartsWith("/__dme/env/", StringComparison.OrdinalIgnoreCase))
                {
                    // /__dme/env/<id>/api/data/... -> https://<that environment>/api/data/...
                    var rest = path.Substring("/__dme/env/".Length);
                    var cut = rest.IndexOf('/');
                    var id = cut < 0 ? rest : Uri.UnescapeDataString(rest.Substring(0, cut));
                    var d = Envs().FirstOrDefault(kv => kv.Key == id).Value;
                    var target = d == null ? null : OrgUrl(d);
                    var api = cut < 0 ? "" : rest.Substring(cut);
                    if (target == null || !api.StartsWith("/api/data/", StringComparison.OrdinalIgnoreCase))
                        e.Response = Error(404, "Not Found", "That environment is not connected in XrmToolBox any more. Add it again.");
                    else
                        e.Response = await ForwardAsync(e.Request, d, target + api + uri.Query);
                }
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
        async Task<CoreWebView2WebResourceResponse> ForwardAsync(CoreWebView2WebResourceRequest r, ConnectionDetail detail, string url)
        {
            if (!string.Equals(r.Method, "GET", StringComparison.OrdinalIgnoreCase))
                return Error(405, "Method Not Allowed", "Data Model Explorer only reads the environment.");
            var client = detail?.ServiceClient;
            var token = client == null ? null : await Task.Run(() => client.CurrentAccessToken);   // refreshed when it has expired
            if (string.IsNullOrEmpty(token))
                return Error(401, "Unauthorized", "This connection does not give an access token. Connect with Microsoft 365 sign-in (OAuth), a client secret or a certificate.");
            var msg = new HttpRequestMessage(HttpMethod.Get, url);
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
