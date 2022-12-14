import { defaultAdminCompanyRelations } from "."
import CompanyService from "../../../../services/company"

export default async (req, res) => {
    const { id } = req.params

    const companyService: CompanyService = req.scope.resolve("companyService")
    const company = await companyService.retrieve(id, { relations: defaultAdminCompanyRelations })

    res.status(200).json({ company })
}
