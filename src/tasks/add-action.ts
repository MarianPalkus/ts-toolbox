import * as path from 'path';
import * as ts from 'typescript';
import {
    Identifier,
    NodeArray,
    NodeFlags,
    ObjectLiteralExpression,
    Statement,
    SyntaxKind,
    TypeAliasDeclaration,
    TypeNode,
    UnionTypeNode,
    VariableStatement
} from 'typescript';
import {convertCamelCaseToConstant} from '../utils/string-utils';
import {createInterface} from '../utils/ts-utils';

export const createActionInterface = (name: string, actionTypeConstant: string): Statement => {
    const propTypeType = ts.createTypeQueryNode(
        ts.createQualifiedName(ts.createIdentifier('ActionTypes'),
            actionTypeConstant));
    return createInterface(name, [{name: 'type', type: propTypeType}]);
};

export const createActionCreator = (name: string, typeConstantName: string) => {
    const actionCreateName = `create${name}`;

    const stmtReturn = ts.createReturn(
        ts.createObjectLiteral(
            [ts.createPropertyAssignment('type', ts.createPropertyAccess(ts.createIdentifier('ActionTypes'), typeConstantName))]
        )
    );
    const expr = ts.createArrowFunction(
        [],
        [],
        [],
        ts.createTypeReferenceNode(name, []),
        ts.createToken(SyntaxKind.EqualsGreaterThanToken),
        ts.createBlock([stmtReturn], true));
    const declaration = ts.createVariableDeclaration(actionCreateName, undefined, expr);
    return ts.createVariableStatement(
        [ts.createToken(SyntaxKind.ExportKeyword)],
        ts.createVariableDeclarationList([declaration], NodeFlags.Const)
    );
};

const createActionTypeConstants = (name: string) => {
    const expr = ts.createLiteral(name);
    const declaration = ts.createVariableDeclaration(name, undefined, expr);
    return ts.createVariableStatement(
        [ts.createToken(SyntaxKind.ExportKeyword)],
        ts.createVariableDeclarationList([declaration], NodeFlags.Const)
    );
};

const createOrUpdateActionUnionTypeDeclaration = (name: string, oldStmt?: Statement) => {
    const stmt = !!oldStmt ? oldStmt : ts.createTypeAliasDeclaration([],
        [ts.createToken(SyntaxKind.ExportKeyword)],
        'Action',
        [],
        ts.createUnionTypeNode([]));

    if (stmt.kind === SyntaxKind.TypeAliasDeclaration) {
        const typeAliasDeclaration = <TypeAliasDeclaration> stmt;
        const type = typeAliasDeclaration.type;

        let unionTypes: NodeArray<TypeNode> = ts.createNodeArray();

        if (type.kind === SyntaxKind.UnionType) {
            const unionType = (<UnionTypeNode> type);
            unionTypes = unionType.types;
        } else if (type.kind === SyntaxKind.TypeReference) {
            unionTypes.push(type);
        }
        unionTypes.push(ts.createTypeReferenceNode(name, []));

        const updatedUnionType = ts.createUnionTypeNode(unionTypes);
        return ts.updateTypeAliasDeclaration(
            typeAliasDeclaration,
            [],
            [ts.createToken(SyntaxKind.ExportKeyword)],
            typeAliasDeclaration.name,
            [],
            updatedUnionType);
    }

    return stmt;
};

const createOrUpdateActionTypesAssignment = (actionTypeConstantName: string, oldStmt?: Statement) => {
    const declaration = ts.createVariableDeclaration('ActionTypes', undefined, ts.createObjectLiteral());
    const stmt = !!oldStmt ?
        oldStmt
        : ts.createVariableStatement([], ts.createVariableDeclarationList([declaration], NodeFlags.Const));

    if (stmt.kind === SyntaxKind.VariableStatement) {
        const variableStatement = <VariableStatement> stmt;
        const variableDeclaration = variableStatement.declarationList.declarations[0];
        if (variableDeclaration && variableDeclaration.initializer &&
            variableDeclaration.initializer.kind === SyntaxKind.ObjectLiteralExpression) {
            const objectLiteralExpr = <ObjectLiteralExpression> variableDeclaration.initializer;
            const properties = objectLiteralExpr.properties;

            const newProperty = ts.createPropertyAssignment(
                actionTypeConstantName,
                ts.createTypeAssertion(
                    ts.createTypeQueryNode(ts.createIdentifier(actionTypeConstantName)),
                    ts.createIdentifier(actionTypeConstantName)));
            properties.push(newProperty)
        }
    }

    return stmt;
};

export const isActionUnionType = (stmt: Statement): boolean =>
    stmt && stmt.kind === SyntaxKind.TypeAliasDeclaration && (<TypeAliasDeclaration> stmt).name.text === 'Action';

export const isActionTypesAssignment = (stmt: Statement): boolean =>
    stmt && stmt.kind === SyntaxKind.VariableStatement
    && (<VariableStatement> stmt).declarationList.declarations[0]
    && (<Identifier>(<VariableStatement> stmt).declarationList.declarations[0].name).text === 'ActionTypes';

export const addAction = (code: string, actionName: string, actionTypeConstant: string) => {
    const originalSourceFile = ts.createSourceFile("action.ts", code, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
    const resultFile = ts.createSourceFile(path.join(__dirname, "action.ts"), "", ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);

    let newStatements = originalSourceFile.statements
        .filter(stmt => !isActionUnionType(stmt) && !isActionTypesAssignment(stmt));

    newStatements.push(createActionTypeConstants(actionTypeConstant));
    newStatements.push(createActionInterface(actionName, actionTypeConstant));
    newStatements.push(createActionCreator(actionName, actionTypeConstant));

    const actionUnionTypeDeclaration = originalSourceFile.statements.find(stm => isActionUnionType(stm));
    newStatements.push(createOrUpdateActionUnionTypeDeclaration(actionName, actionUnionTypeDeclaration));

    const actionTypesAssignment = originalSourceFile.statements.find(stm => isActionTypesAssignment(stm));
    newStatements.push(createOrUpdateActionTypesAssignment(actionTypeConstant, actionTypesAssignment));

    const sourceFile = ts.updateSourceFileNode(originalSourceFile, newStatements);

    const printer = ts.createPrinter(
        {
            // Options
        },
        {
            // PrintHandlers
        });

    try {
        return printer.printNode(ts.EmitHint.Unspecified, sourceFile, resultFile);
    } catch (e) {
        console.log('error: ', e);
    }
};

export const execute = (args: string[], readFile: (path: string) => string, writeFile: (path: string, content: string) => void) => {
    const actionFilePath = args[0];
    const actionName = args[1];
    const actionTypeConstant = args[2] || convertCamelCaseToConstant(actionName).toUpperCase();
    const code = readFile(actionFilePath);

    const newCode = addAction(code, actionName, actionTypeConstant);
    writeFile(actionFilePath, newCode);
};

export const task: TsToolboxTask = {
    argumentInfo: [
        {
            description: 'Action File Path',
            required: true,
            defaultValue: './action.ts'
        },
        {
            description: 'Action Name',
            required: true
        },
        {
            description: 'Action Type Constant (default is action name as pascal case',
            required: false
        }
    ],
    command: 'add-action',
    execute: execute
};