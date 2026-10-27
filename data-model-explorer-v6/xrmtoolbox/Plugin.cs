using System.ComponentModel.Composition;
using XrmToolBox.Extensibility;
using XrmToolBox.Extensibility.Interfaces;

namespace FormusPro.DataModelExplorer
{
    // How XrmToolBox finds the tool: its name, description and icons in the tool list.
    [Export(typeof(IXrmToolBoxPlugin)),
     ExportMetadata("Name", "Data Model Explorer"),
     ExportMetadata("Description", "Open a Dataverse data-model workbook, check it, draw the ERD and build a solution. Load a solution from the connected environment as the model, or check a workbook against it for undocumented and unmanaged changes."),
     ExportMetadata("SmallImageBase64", Icons.Small),
     ExportMetadata("BigImageBase64", Icons.Big),
     ExportMetadata("BackgroundColor", "White"),
     ExportMetadata("PrimaryFontColor", "#0A4873"),
     ExportMetadata("SecondaryFontColor", "Gray")]
    public class Plugin : PluginBase
    {
        public override IXrmToolBoxPluginControl GetControl() => new ExplorerControl();
    }
}
